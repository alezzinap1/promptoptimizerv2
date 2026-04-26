"""Stability evaluation: rubrics CRUD + run create/stream/cancel/delete + summaries.

This single router groups every ``/api/eval/*`` endpoint. The Studio UI calls
into it from the new "Stability" tab inside ``/compare``.

All endpoints require an authenticated session. Models are restricted to the
"cheap tier" whitelist (see ``services.eval.cheap_tier``) so a typical run
stays under a dollar.
"""
from __future__ import annotations

import hashlib
import json
import queue
import time
from datetime import datetime, timezone
from typing import Any, Iterator, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.deps import get_current_user, get_db
from db.manager import DBManager
from services.api_key_resolver import resolve_openrouter_api_key
from services.eval.cheap_tier import (
    DEFAULT_EMBEDDING_MODEL,
    DEFAULT_JUDGE_MODEL,
    require_cheap_embedding,
    require_cheap_judge,
)
from services.eval.cost_estimator import estimate_run_cost
from services.eval.event_bus import BUS
from services.eval.rubric_presets import get_preset_rubric, list_preset_rubrics
from services.eval.lineage import fingerprints_for_stored_run
from services.eval.run_executor import cancel_run, start_eval_run
from services.llm_client import LLMClient

router = APIRouter()

# Hard caps. Beyond these we refuse the request — kept conservative so a
# misclick can't burn through someone's daily budget.
MAX_N_RUNS = 50
MAX_PAIR_JUDGE_SAMPLES = 20
MAX_EXPECTED_OUTPUT_TOKENS = 4000


def _today_utc() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _resolve_rubric_snapshot(
    *,
    db: DBManager,
    user_id: int,
    preset_key: str | None,
    rubric_id: int | None,
) -> tuple[dict, int | None]:
    """Return (rubric_snapshot_dict, rubric_id_or_None) given preset/custom inputs."""
    if rubric_id:
        custom = db.get_eval_rubric(int(rubric_id), user_id=user_id)
        if not custom:
            raise HTTPException(404, "Rubric not found")
        snap = {
            "name": custom.get("name"),
            "preset_key": custom.get("preset_key"),
            "reference_required": bool(custom.get("reference_required")),
            "criteria": custom.get("criteria") or [],
        }
        return snap, int(rubric_id)
    if preset_key:
        preset = get_preset_rubric(preset_key)
        if not preset:
            raise HTTPException(400, f"Unknown preset_key: {preset_key}")
        snap = {
            "name": preset.get("name"),
            "preset_key": preset_key,
            "reference_required": bool(preset.get("reference_required")),
            "criteria": preset.get("criteria") or [],
        }
        return snap, None
    raise HTTPException(400, "Either preset_key or rubric_id must be provided")


# ─── Pydantic models ──────────────────────────────────────────────────────


class RubricCriterion(BaseModel):
    key: str = Field(..., min_length=1, max_length=64)
    weight: float = Field(1.0, ge=0.0, le=10.0)
    description: str = Field("", max_length=2000)
    anchors: dict[str, str] = Field(default_factory=dict)


class RubricCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    criteria: list[RubricCriterion] = Field(..., min_length=1, max_length=20)
    preset_key: str | None = None
    reference_required: bool = False


class RubricUpdate(BaseModel):
    name: str | None = Field(None, max_length=200)
    criteria: list[RubricCriterion] | None = Field(None, min_length=1, max_length=20)
    reference_required: bool | None = None


class PreviewCostRequest(BaseModel):
    prompt_a_text: str = Field(..., min_length=1, max_length=20000)
    prompt_b_text: str | None = Field(None, max_length=20000)
    task_input: str = Field(..., min_length=1, max_length=20000)
    reference_answer: str | None = Field(None, max_length=20000)
    n_runs: int = Field(..., ge=1, le=MAX_N_RUNS)
    target_model_id: str = Field(..., min_length=1)
    judge_model_id: str = Field(default=DEFAULT_JUDGE_MODEL)
    judge_secondary_model_id: str | None = Field(None, max_length=200)
    embedding_model_id: str = Field(default=DEFAULT_EMBEDDING_MODEL)
    synthesis_model_id: str | None = Field(None, max_length=200)
    run_synthesis: bool = True
    expected_output_tokens: int = Field(600, ge=1, le=MAX_EXPECTED_OUTPUT_TOKENS)
    pair_judge_samples: int = Field(0, ge=0, le=MAX_PAIR_JUDGE_SAMPLES)
    meta_synthesis_mode: Literal["full", "lite"] = "full"


class CreateRunRequest(BaseModel):
    prompt_a_text: str = Field(..., min_length=1, max_length=20000)
    prompt_b_text: str | None = Field(None, max_length=20000)
    task_input: str = Field(..., min_length=1, max_length=20000)
    reference_answer: str | None = Field(None, max_length=20000)
    n_runs: int = Field(..., ge=1, le=MAX_N_RUNS)
    target_model_id: str = Field(..., min_length=1)
    judge_model_id: str = Field(default=DEFAULT_JUDGE_MODEL)
    judge_secondary_model_id: str | None = Field(None, max_length=200)
    embedding_model_id: str = Field(default=DEFAULT_EMBEDDING_MODEL)
    synthesis_model_id: str | None = Field(None, max_length=200)
    run_synthesis: bool = True
    expected_output_tokens: int = Field(600, ge=1, le=MAX_EXPECTED_OUTPUT_TOKENS)
    pair_judge_samples: int = Field(0, ge=0, le=MAX_PAIR_JUDGE_SAMPLES)
    meta_synthesis_mode: Literal["full", "lite"] = "full"
    temperature: float = Field(0.7, ge=0.0, le=2.0)
    top_p: float | None = Field(None, ge=0.0, le=1.0)
    parallelism: int = Field(4, ge=1, le=16)
    preset_key: str | None = None
    rubric_id: int | None = None
    prompt_a_library_id: int | None = None
    prompt_a_library_version: int | None = None
    prompt_b_library_id: int | None = None
    prompt_b_library_version: int | None = None


# ─── Rubrics CRUD ─────────────────────────────────────────────────────────


@router.get("/eval/rubrics")
def list_rubrics(
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
) -> dict[str, Any]:
    """Return built-in presets and the user's custom rubrics."""
    custom = db.list_eval_rubrics(int(user["id"]))
    return {
        "presets": list_preset_rubrics(),
        "custom": custom,
    }


@router.post("/eval/rubrics")
def create_rubric(
    req: RubricCreate,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
) -> dict[str, Any]:
    rid = db.create_eval_rubric(
        user_id=int(user["id"]),
        name=req.name,
        criteria=[c.model_dump() for c in req.criteria],
        preset_key=req.preset_key,
        reference_required=req.reference_required,
    )
    return {"id": rid, "ok": True}


@router.patch("/eval/rubrics/{rubric_id}")
def update_rubric(
    rubric_id: int,
    req: RubricUpdate,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
) -> dict[str, Any]:
    existing = db.get_eval_rubric(rubric_id, user_id=int(user["id"]))
    if not existing:
        raise HTTPException(404, "Rubric not found")
    ok = db.update_eval_rubric(
        rubric_id=rubric_id,
        user_id=int(user["id"]),
        name=req.name,
        criteria=[c.model_dump() for c in req.criteria] if req.criteria is not None else None,
        reference_required=req.reference_required,
    )
    if not ok:
        raise HTTPException(400, "No changes")
    return {"ok": True}


@router.delete("/eval/rubrics/{rubric_id}")
def delete_rubric(
    rubric_id: int,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
) -> dict[str, Any]:
    existing = db.get_eval_rubric(rubric_id, user_id=int(user["id"]))
    if not existing:
        raise HTTPException(404, "Rubric not found")
    db.delete_eval_rubric(rubric_id, user_id=int(user["id"]))
    return {"ok": True}


# ─── Cost preview ─────────────────────────────────────────────────────────


@router.post("/eval/stability/preview-cost")
def preview_cost(
    req: PreviewCostRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
) -> dict[str, Any]:
    """Estimate token + USD cost for a stability run before launching it.

    Validates the judge/embedding models against the cheap-tier whitelist and
    flags whether the user's remaining daily budget would cover the run.
    """
    try:
        require_cheap_judge(req.judge_model_id)
        if (req.judge_secondary_model_id or "").strip():
            require_cheap_judge(req.judge_secondary_model_id.strip())
        if req.run_synthesis and (req.synthesis_model_id or "").strip():
            require_cheap_judge(req.synthesis_model_id.strip())
        require_cheap_embedding(req.embedding_model_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    estimate = estimate_run_cost(
        prompt_a_text=req.prompt_a_text,
        task_input=req.task_input,
        n_runs=req.n_runs,
        target_model_id=req.target_model_id,
        judge_model_id=req.judge_model_id,
        embedding_model_id=req.embedding_model_id,
        expected_output_tokens=req.expected_output_tokens,
        prompt_b_text=req.prompt_b_text,
        reference_answer=req.reference_answer,
        pair_judge_samples=req.pair_judge_samples,
        judge_secondary_model_id=req.judge_secondary_model_id,
        run_synthesis=req.run_synthesis,
        synthesis_model_id=req.synthesis_model_id,
        meta_synthesis_mode=req.meta_synthesis_mode,
    )

    uid = int(user["id"])
    budget = db.get_user_eval_budget(uid)
    spent = db.get_eval_daily_usage(uid, _today_utc())
    remaining = max(0.0, budget - spent)
    over = bool(estimate["total_usd"] > remaining)

    return {
        **estimate,
        "daily_budget_usd": budget,
        "daily_spent_usd": spent,
        "daily_remaining_usd": remaining,
        "over_daily_budget": over,
    }


# ─── Run creation ─────────────────────────────────────────────────────────


@router.post("/eval/stability/runs")
def create_run(
    req: CreateRunRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
) -> dict[str, Any]:
    """Create a stability run record and kick off the background executor.

    Errors out early when the daily budget is too low — we never silently start
    a run we can't afford.
    """
    uid = int(user["id"])

    try:
        require_cheap_judge(req.judge_model_id)
        if (req.judge_secondary_model_id or "").strip():
            require_cheap_judge(req.judge_secondary_model_id.strip())
        if req.run_synthesis and (req.synthesis_model_id or "").strip():
            require_cheap_judge(req.synthesis_model_id.strip())
        require_cheap_embedding(req.embedding_model_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    snapshot, rubric_id = _resolve_rubric_snapshot(
        db=db,
        user_id=uid,
        preset_key=req.preset_key,
        rubric_id=req.rubric_id,
    )
    if snapshot.get("reference_required") and not (req.reference_answer or "").strip():
        raise HTTPException(400, "This rubric requires a reference_answer")

    estimate = estimate_run_cost(
        prompt_a_text=req.prompt_a_text,
        task_input=req.task_input,
        n_runs=req.n_runs,
        target_model_id=req.target_model_id,
        judge_model_id=req.judge_model_id,
        embedding_model_id=req.embedding_model_id,
        expected_output_tokens=req.expected_output_tokens,
        prompt_b_text=req.prompt_b_text,
        reference_answer=req.reference_answer,
        pair_judge_samples=req.pair_judge_samples,
        judge_secondary_model_id=req.judge_secondary_model_id,
        run_synthesis=req.run_synthesis,
        synthesis_model_id=req.synthesis_model_id,
        meta_synthesis_mode=req.meta_synthesis_mode,
    )

    budget = db.get_user_eval_budget(uid)
    spent = db.get_eval_daily_usage(uid, _today_utc())
    remaining = max(0.0, budget - spent)
    if estimate["total_usd"] > remaining:
        raise HTTPException(
            402,
            f"Estimated cost ${estimate['total_usd']:.4f} exceeds remaining daily budget "
            f"${remaining:.4f}. Adjust the budget in Settings or reduce n_runs.",
        )

    user_key = db.get_user_openrouter_api_key(uid)
    api_key = resolve_openrouter_api_key(user_key)
    if not api_key:
        raise HTTPException(500, "OpenRouter API key not set. Введите свой ключ в Настройках.")

    is_pair = bool((req.prompt_b_text or "").strip())
    sec = (req.judge_secondary_model_id or "").strip() or None
    if sec and sec == req.judge_model_id.strip():
        sec = None
    syn_mod = (req.synthesis_model_id or "").strip() or None

    pfp, tfp, rfp = fingerprints_for_stored_run(
        {
            "prompt_a_text": req.prompt_a_text,
            "prompt_b_text": req.prompt_b_text if is_pair else None,
            "task_input": req.task_input,
            "reference_answer": req.reference_answer,
            "rubric_snapshot": snapshot,
        }
    )

    run_id = db.create_eval_run(
        user_id=uid,
        mode="pair" if is_pair else "single",
        prompt_a_text=req.prompt_a_text,
        prompt_a_hash=_sha(req.prompt_a_text),
        prompt_a_library_id=req.prompt_a_library_id,
        prompt_a_library_version=req.prompt_a_library_version,
        prompt_b_text=req.prompt_b_text if is_pair else None,
        prompt_b_hash=_sha(req.prompt_b_text) if is_pair else None,
        prompt_b_library_id=req.prompt_b_library_id if is_pair else None,
        prompt_b_library_version=req.prompt_b_library_version if is_pair else None,
        task_input=req.task_input,
        reference_answer=req.reference_answer,
        target_model_id=req.target_model_id,
        judge_model_id=req.judge_model_id,
        embedding_model_id=req.embedding_model_id,
        rubric_id=rubric_id,
        rubric_snapshot=snapshot,
        n_runs=req.n_runs,
        parallelism=req.parallelism,
        temperature=req.temperature,
        top_p=req.top_p,
        pair_judge_samples=req.pair_judge_samples if is_pair else 0,
        cost_preview_usd=float(estimate["total_usd"]),
        cost_preview_tokens=int(estimate["total_tokens"]),
        status="queued",
        judge_secondary_model_id=sec,
        run_synthesis=req.run_synthesis,
        synthesis_model_id=syn_mod,
        prompt_fingerprint=pfp,
        task_fingerprint=tfp,
        rubric_fingerprint=rfp,
        meta_synthesis_mode=req.meta_synthesis_mode,
    )

    client = LLMClient(api_key)
    start_eval_run(db, client, run_id)

    return {
        "run_id": run_id,
        "status": "queued",
        "cost_preview_usd": float(estimate["total_usd"]),
        "cost_preview_tokens": int(estimate["total_tokens"]),
        "mode": "pair" if is_pair else "single",
    }


# ─── Run details / lifecycle ──────────────────────────────────────────────


def _ensure_owns_run(db: DBManager, run_id: int, user_id: int) -> dict:
    run = db.get_eval_run(int(run_id), user_id=int(user_id))
    if not run:
        raise HTTPException(404, "Run not found")
    return run


@router.get("/eval/stability/runs/series")
def list_run_series(
    library_id: int | None = None,
    prompt_fingerprint: str | None = None,
    task_fingerprint: str | None = None,
    rubric_fingerprint: str | None = None,
    target_model_id: str | None = None,
    group_by_model: bool = False,
    limit: int = 80,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
) -> dict[str, Any]:
    """Comparable completed runs for trend charts (C1: same lineage; C2: optional model filter)."""
    uid = int(user["id"])
    lim = max(1, min(int(limit or 80), 200))

    if library_id is not None:
        runs_lib = db.list_eval_runs_for_library(int(library_id), limit=80)
        runs_lib = [
            r
            for r in runs_lib
            if int(r.get("user_id", 0)) == uid and r.get("status") == "completed"
        ]
        if not runs_lib:
            return {"runs": [], "fingerprints": None, "group_by_model": None}
        anchor = runs_lib[0]
        db.backfill_eval_run_lineage(int(anchor["id"]))
        anchor = db.get_eval_run(int(anchor["id"]), uid)
        if not anchor:
            return {"runs": [], "fingerprints": None, "group_by_model": None}
        pfp = anchor.get("prompt_fingerprint")
        tfp = anchor.get("task_fingerprint")
        rfp = anchor.get("rubric_fingerprint")
        if not pfp or not tfp or not rfp:
            pfp, tfp, rfp = fingerprints_for_stored_run(anchor)
    else:
        if not (prompt_fingerprint and task_fingerprint and rubric_fingerprint):
            raise HTTPException(
                400,
                "Provide library_id or all of prompt_fingerprint, task_fingerprint, rubric_fingerprint",
            )
        pfp, tfp, rfp = prompt_fingerprint, task_fingerprint, rubric_fingerprint

    series = db.list_eval_runs_series(
        uid,
        prompt_fingerprint=pfp,
        task_fingerprint=tfp,
        rubric_fingerprint=rfp,
        target_model_id=(target_model_id.strip() if target_model_id else None),
        limit=lim,
    )
    fps = {"prompt_fingerprint": pfp, "task_fingerprint": tfp, "rubric_fingerprint": rfp}
    if not group_by_model:
        return {"runs": series, "fingerprints": fps, "group_by_model": None}
    bym: dict[str, list[dict[str, Any]]] = {}
    for r in series:
        mid = str(r.get("target_model_id") or "unknown")
        bym.setdefault(mid, []).append(r)
    return {"runs": series, "fingerprints": fps, "group_by_model": bym}


@router.get("/eval/stability/runs/{run_id}")
def get_run(
    run_id: int,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
) -> dict[str, Any]:
    """Return run + per-output results (with judge scores) for the result panels."""
    run = _ensure_owns_run(db, run_id, int(user["id"]))
    db.backfill_eval_run_lineage(int(run_id))
    run = _ensure_owns_run(db, run_id, int(user["id"]))
    raw_syn = run.pop("synthesis_report_json", None)
    run["synthesis_report"] = None
    if raw_syn:
        try:
            run["synthesis_report"] = json.loads(raw_syn)
        except Exception:
            run["synthesis_report"] = None
    raw_meta = run.pop("meta_pipeline_json", None)
    run["meta_pipeline"] = None
    if raw_meta:
        try:
            run["meta_pipeline"] = json.loads(raw_meta)
        except Exception:
            run["meta_pipeline"] = None
    results = db.list_eval_results_for_run(run_id)
    for r in results:
        r["judge_scores"] = db.list_judge_scores_for_result(int(r["id"]))
    return {"run": run, "results": results}


@router.get("/eval/stability/runs")
def list_runs(
    limit: int = 50,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
) -> dict[str, Any]:
    runs = db.list_eval_runs_for_user(int(user["id"]), limit=max(1, min(int(limit or 50), 200)))
    return {"runs": runs}


@router.delete("/eval/stability/runs/{run_id}")
def delete_run(
    run_id: int,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
) -> dict[str, Any]:
    _ensure_owns_run(db, run_id, int(user["id"]))
    cancel_run(int(run_id))  # best-effort: stop the worker if still alive
    db.delete_eval_run(int(run_id), user_id=int(user["id"]))
    return {"ok": True}


@router.post("/eval/stability/runs/{run_id}/cancel")
def cancel_run_endpoint(
    run_id: int,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
) -> dict[str, Any]:
    run = _ensure_owns_run(db, run_id, int(user["id"]))
    if run["status"] not in ("queued", "running"):
        return {"ok": True, "status": run["status"], "note": "already finished"}
    cancel_run(int(run_id))
    return {"ok": True, "requested": True}


# ─── SSE stream ────────────────────────────────────────────────────────────


_SSE_KEEPALIVE_SEC = 15.0


def _sse_event(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _stream_run_events(run_id: int, request: Request) -> Iterator[str]:
    """Replay history, then forward live events until ``done`` or disconnect."""
    q = BUS.subscribe(int(run_id))
    try:
        sent_done = False
        for evt in BUS.replay(int(run_id)):
            yield _sse_event(evt)
            if evt.get("type") == "done":
                sent_done = True
        if sent_done:
            return
        last = time.monotonic()
        while True:
            try:
                evt = q.get(timeout=1.0)
            except queue.Empty:
                if time.monotonic() - last >= _SSE_KEEPALIVE_SEC:
                    last = time.monotonic()
                    yield ": keepalive\n\n"
                continue
            yield _sse_event(evt)
            last = time.monotonic()
            if evt.get("type") == "done":
                return
    finally:
        BUS.unsubscribe(int(run_id), q)


@router.get("/library/{item_id}/eval-summary")
def library_eval_summary(
    item_id: int,
    limit: int = 20,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
) -> dict[str, Any]:
    """Latest stability runs that reference this library item (current user only).

    Used by the Library card to show a "stability badge" with last p50 + diversity.
    """
    runs = db.list_eval_runs_for_library(int(item_id), limit=max(1, min(int(limit or 20), 50)))
    runs = [r for r in runs if int(r.get("user_id", 0)) == int(user["id"])]
    last = runs[0] if runs else None
    return {"runs": runs, "count": len(runs), "last": last}


@router.get("/eval/stability/runs/{run_id}/stream")
def stream_run(
    run_id: int,
    request: Request,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    _ensure_owns_run(db, run_id, int(user["id"]))
    return StreamingResponse(
        _stream_run_events(run_id, request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )
