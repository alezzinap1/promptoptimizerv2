"""Background executor for stability evaluation runs.

A "run" is a fixed-input experiment: take prompt(s), call the target model
N times, score every output with the judge LLM, embed every output, and
compute aggregate stability stats. In pair mode (A vs B) we additionally run
K judge comparisons to declare a winner.

Pipeline (per run):

  1. **generate** — N (single) or 2N (pair) parallel calls to the target model
  2. **judge** — one judge call per generated output (parallel)
  3. **embed** — single batch call for all outputs (or sequential fallback)
  4. **persist** — insert ``eval_results`` + ``eval_judge_scores``
  5. **aggregate** — quantiles + diversity per side
  6. **pair-judge** — K comparisons (only when ``mode == "pair"``)
  7. **finalize** — write summary fields onto ``eval_runs`` and emit ``done``

Threading model:

  - One outer pool ``_RUN_POOL`` runs the run-level coroutine for several runs
    in parallel. Each run, in turn, opens an inner ``ThreadPoolExecutor`` for
    its own per-output parallelism. This is fine for sync I/O-bound LLM calls.
  - ``cancel_run(run_id)`` flips a ``threading.Event`` checked between phases
    and after each per-output future completes. Already-in-flight LLM calls
    are not aborted (the OpenAI SDK doesn't support that mid-stream); they
    finish and their result is then ignored.

Cost accounting in MVP:

  We don't read OpenRouter's actual ``usage`` tokens back yet — the run is
  finalised with ``cost_actual_usd = cost_preview_usd`` as a stub. The preview
  cap already protects the daily budget, so the worst case is "what we told
  the user".
"""
from __future__ import annotations

import json
import logging
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any

from db.manager import DBManager
from services.eval.aggregator import (
    pair_winner_summary,
    summarize_overall_scores,
)
from services.eval.diversity import diversity_summary
from services.eval.event_bus import BUS
from services.eval.judge_runner import judge_one, judge_pair
from services.eval.meta_pipeline import run_meta_pipeline
from services.eval.synthesis import result_rows_to_synthesis_outputs, run_synthesis

logger = logging.getLogger(__name__)

_RUN_POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix="eval-run")
EXECUTOR_REGISTRY: dict[int, dict[str, Any]] = {}
_REGISTRY_LOCK = threading.Lock()


def start_eval_run(db: DBManager, llm_client, run_id: int) -> Future:
    """Submit a run for background execution. Returns a Future."""
    cancel = threading.Event()
    fut = _RUN_POOL.submit(_execute, db, llm_client, run_id, cancel)
    with _REGISTRY_LOCK:
        EXECUTOR_REGISTRY[int(run_id)] = {"future": fut, "cancel": cancel}
    return fut


def cancel_run(run_id: int) -> bool:
    """Request cancellation. Returns True if the run was registered."""
    with _REGISTRY_LOCK:
        entry = EXECUTOR_REGISTRY.get(int(run_id))
    if not entry:
        return False
    entry["cancel"].set()
    return True


def is_running(run_id: int) -> bool:
    with _REGISTRY_LOCK:
        return int(run_id) in EXECUTOR_REGISTRY


# ─── implementation ───────────────────────────────────────────────────────


def _generate_one(
    *,
    client,
    prompt: str,
    task_input: str,
    target_model: str,
    temperature: float,
    top_p: float | None,
    side: str,
    run_index: int,
) -> dict:
    """Single target-model call. Returns a result dict; never raises."""
    started = time.monotonic()
    try:
        text = client.generate(
            system_prompt=prompt,
            user_content=task_input,
            provider=target_model,
            temperature=temperature,
            top_p=top_p,
        )
        latency = int((time.monotonic() - started) * 1000)
        return {
            "side": side,
            "run_index": run_index,
            "output_text": text or "",
            "input_tokens": 0,
            "output_tokens": len(text or "") // 4,
            "latency_ms": latency,
            "status": "ok",
            "error": None,
        }
    except Exception as exc:  # noqa: BLE001
        latency = int((time.monotonic() - started) * 1000)
        return {
            "side": side,
            "run_index": run_index,
            "output_text": "",
            "input_tokens": 0,
            "output_tokens": 0,
            "latency_ms": latency,
            "status": "error",
            "error": str(exc),
        }


def _judge_one_safe(
    *,
    client,
    judge_model: str,
    rubric: dict,
    prompt: str,
    task_input: str,
    output_text: str,
    reference: str | None,
    side: str,
    run_index: int,
) -> dict:
    res = judge_one(
        client=client,
        judge_model_id=judge_model,
        rubric=rubric,
        prompt_text=prompt,
        task_input=task_input,
        output_text=output_text,
        reference_answer=reference,
    )
    res["side"] = side
    res["run_index"] = run_index
    return res


def _execute(db: DBManager, client, run_id: int, cancel: threading.Event) -> None:
    started_mono = time.monotonic()
    try:
        run = db.get_eval_run(run_id, user_id=None)
        if not run:
            logger.warning("run %s not found, aborting", run_id)
            return

        db.update_eval_run_status(run_id, status="running")
        BUS.publish(
            run_id,
            {
                "type": "started",
                "run_id": run_id,
                "n_runs": run["n_runs"],
                "mode": run["mode"],
                "target_model_id": run["target_model_id"],
                "judge_model_id": run["judge_model_id"],
            },
        )

        is_pair = run["mode"] == "pair"
        sides = ["A", "B"] if is_pair else ["A"]
        rubric = run["rubric_snapshot"]
        parallelism = max(1, int(run.get("parallelism") or 4))
        n_runs = int(run["n_runs"])

        # ── PHASE 1: generate ─────────────────────────────────────────
        outputs: dict[str, list[dict]] = {"A": [], "B": []}
        with ThreadPoolExecutor(max_workers=parallelism, thread_name_prefix=f"eval-{run_id}-gen") as pool:
            gen_futures = []
            for side in sides:
                prompt = run["prompt_a_text"] if side == "A" else run["prompt_b_text"]
                for idx in range(n_runs):
                    if cancel.is_set():
                        break
                    gen_futures.append(
                        pool.submit(
                            _generate_one,
                            client=client,
                            prompt=prompt,
                            task_input=run["task_input"],
                            target_model=run["target_model_id"],
                            temperature=float(run["temperature"]),
                            top_p=run.get("top_p"),
                            side=side,
                            run_index=idx,
                        )
                    )
            for f in gen_futures:
                r = f.result()
                outputs[r["side"]].append(r)
                BUS.publish(
                    run_id,
                    {
                        "type": "progress",
                        "phase": "generate",
                        "side": r["side"],
                        "run_index": r["run_index"],
                        "status": r["status"],
                        "preview": (r["output_text"] or "")[:120],
                    },
                )

        if cancel.is_set():
            _finalize_cancelled(db, run_id, started_mono)
            return

        # ── PHASE 2: primary judge per output (skip errored generations) ─
        judge_results: dict[tuple[str, int], dict] = {}
        with ThreadPoolExecutor(max_workers=parallelism, thread_name_prefix=f"eval-{run_id}-judge") as pool:
            jf = []
            for side in sides:
                prompt = run["prompt_a_text"] if side == "A" else run["prompt_b_text"]
                for o in outputs[side]:
                    if o["status"] != "ok":
                        continue
                    if cancel.is_set():
                        break
                    jf.append(
                        pool.submit(
                            _judge_one_safe,
                            client=client,
                            judge_model=run["judge_model_id"],
                            rubric=rubric,
                            prompt=prompt,
                            task_input=run["task_input"],
                            output_text=o["output_text"],
                            reference=run.get("reference_answer"),
                            side=side,
                            run_index=o["run_index"],
                        )
                    )
            for f in jf:
                r = f.result()
                judge_results[(r["side"], r["run_index"])] = r
                BUS.publish(
                    run_id,
                    {
                        "type": "progress",
                        "phase": "judge",
                        "side": r["side"],
                        "run_index": r["run_index"],
                        "judge_overall": r.get("overall"),
                    },
                )

        # ── PHASE 2b: secondary judge (MVP-1.5) ─────────────────────────
        sec_model = (run.get("judge_secondary_model_id") or "").strip()
        if (
            sec_model
            and sec_model != (run.get("judge_model_id") or "").strip()
            and not cancel.is_set()
        ):
            with ThreadPoolExecutor(
                max_workers=parallelism, thread_name_prefix=f"eval-{run_id}-judge2"
            ) as pool:
                jf2 = []
                for side in sides:
                    prompt = run["prompt_a_text"] if side == "A" else run["prompt_b_text"]
                    for o in outputs[side]:
                        if o["status"] != "ok":
                            continue
                        if cancel.is_set():
                            break
                        jf2.append(
                            pool.submit(
                                _judge_one_safe,
                                client=client,
                                judge_model=sec_model,
                                rubric=rubric,
                                prompt=prompt,
                                task_input=run["task_input"],
                                output_text=o["output_text"],
                                reference=run.get("reference_answer"),
                                side=side,
                                run_index=o["run_index"],
                            )
                        )
                for f in jf2:
                    r2 = f.result()
                    key = (r2["side"], r2["run_index"])
                    base = judge_results.get(key) or {}
                    base["secondary_overall"] = r2.get("overall")
                    base["secondary_reasoning"] = r2.get("reasoning")
                    judge_results[key] = base
                    BUS.publish(
                        run_id,
                        {
                            "type": "progress",
                            "phase": "judge_secondary",
                            "side": r2["side"],
                            "run_index": r2["run_index"],
                            "judge_secondary_overall": r2.get("overall"),
                        },
                    )

        agreement_mean: float | None = None
        diffs: list[float] = []
        for _k, jr in judge_results.items():
            a = jr.get("overall")
            b = jr.get("secondary_overall")
            if a is not None and b is not None:
                diffs.append(abs(float(a) - float(b)))
        if diffs:
            agreement_mean = round(sum(diffs) / len(diffs), 4)

        if cancel.is_set():
            _finalize_cancelled(db, run_id, started_mono)
            return

        # ── PHASE 3: batch embeddings ────────────────────────────────
        text_pos: list[tuple[str, int]] = []
        text_list: list[str] = []
        for side in sides:
            for o in outputs[side]:
                if o["status"] == "ok":
                    text_pos.append((side, o["run_index"]))
                    text_list.append(o["output_text"])
        embeddings: dict[tuple[str, int], list[float]] = {}
        if text_list:
            try:
                vecs = client.embed(text_list, run["embedding_model_id"])
                for pos, v in zip(text_pos, vecs):
                    embeddings[pos] = v
                BUS.publish(run_id, {"type": "progress", "phase": "embed", "count": len(vecs)})
            except Exception as exc:  # noqa: BLE001
                logger.warning("run %s: embeddings failed (%s) — continuing without diversity", run_id, exc)
                BUS.publish(run_id, {"type": "progress", "phase": "embed", "error": str(exc)})

        # ── PHASE 4: persist results + judge scores ──────────────────
        for side in sides:
            for o in outputs[side]:
                key = (side, o["run_index"])
                j = judge_results.get(key)
                emb = embeddings.get(key)
                res_id = db.insert_eval_result(
                    run_id=run_id,
                    prompt_side=side,
                    run_index=o["run_index"],
                    output_text=o["output_text"],
                    output_tokens=o["output_tokens"],
                    input_tokens=o["input_tokens"],
                    latency_ms=o["latency_ms"],
                    status=o["status"],
                    embedding=emb,
                    judge_overall=j.get("overall") if j else None,
                    judge_overall_secondary=j.get("secondary_overall") if j else None,
                    judge_reasoning=j.get("reasoning") if j else None,
                    judge_reasoning_secondary=j.get("secondary_reasoning") if j else None,
                    error=o.get("error"),
                )
                if j and j.get("scores"):
                    db.insert_judge_scores(res_id, j["scores"])

        # ── PHASE 5: aggregate per side ──────────────────────────────
        side_summaries: dict[str, dict] = {}
        for side in sides:
            scores = [
                judge_results.get((side, o["run_index"]), {}).get("overall")
                for o in outputs[side]
                if o["status"] == "ok"
            ]
            stats = summarize_overall_scores(scores)
            vecs = [embeddings[(side, o["run_index"])] for o in outputs[side] if (side, o["run_index"]) in embeddings]
            div = diversity_summary(vecs)["diversity_score"] if len(vecs) >= 2 else 0.0
            side_summaries[side] = {"stats": stats, "diversity": div}

        # ── PHASE 6: pair judge ──────────────────────────────────────
        pair_summary: dict | None = None
        if is_pair and int(run.get("pair_judge_samples") or 0) > 0:
            pair_summary = _run_pair_judge(
                client=client,
                run=run,
                outputs=outputs,
                cancel=cancel,
                parallelism=parallelism,
                run_id=run_id,
            )

        # ── PHASE 6b: meta-synthesis (all outputs + prompt → one report) ─
        synthesis_report: dict | None = None
        synthesis_error: str | None = None
        meta_pipeline_str: str | None = None
        run_synth = bool(run.get("run_synthesis", True))
        meta_mode = str(run.get("meta_synthesis_mode") or "full").strip().lower()
        if meta_mode not in ("full", "lite"):
            meta_mode = "full"
        if run_synth and not cancel.is_set():
            try:
                synth_model = (run.get("synthesis_model_id") or run["judge_model_id"] or "").strip()
                syn_summaries = {
                    s: {
                        "stats": side_summaries[s]["stats"],
                        "diversity": side_summaries[s]["diversity"],
                    }
                    for s in sides
                }
                result_rows = db.list_eval_results_for_run(run_id)
                syn: dict | None = None
                meta_blob: dict | None = None
                syn_err: str | None = None
                if meta_mode == "lite":
                    outputs = result_rows_to_synthesis_outputs(result_rows)
                    if not outputs:
                        syn_err = "no_ok_outputs_for_synthesis"
                    else:
                        syn = run_synthesis(
                            client=client,
                            synthesis_model_id=synth_model,
                            task_input=run["task_input"],
                            prompt_a_text=run["prompt_a_text"],
                            prompt_b_text=run.get("prompt_b_text"),
                            rubric_snapshot=rubric,
                            side_summaries=syn_summaries,
                            outputs=outputs,
                        )
                        meta_blob = {"schema_version": 1, "mode": "lite", "single_pass": True}
                else:
                    syn, meta_blob, syn_err = run_meta_pipeline(
                        client=client,
                        synthesis_model_id=synth_model,
                        task_input=run["task_input"],
                        prompt_a_text=run["prompt_a_text"],
                        prompt_b_text=run.get("prompt_b_text"),
                        rubric_snapshot=rubric,
                        side_summaries=syn_summaries,
                        result_rows=result_rows,
                    )
                meta_pipeline_str = json.dumps(meta_blob, ensure_ascii=False) if meta_blob else None
                if syn_err:
                    synthesis_error = syn_err
                if syn and isinstance(syn, dict) and (
                    (syn.get("summary") or "").strip()
                    or syn.get("failure_modes")
                    or syn.get("prompt_fixes")
                ):
                    synthesis_report = syn
                elif not synthesis_error:
                    synthesis_error = "synthesis_empty_or_invalid"
                BUS.publish(run_id, {"type": "progress", "phase": "synthesis", "ok": not synthesis_error})
            except Exception as exc:  # noqa: BLE001
                logger.warning("run %s synthesis failed: %s", run_id, exc)
                synthesis_error = str(exc)
                BUS.publish(run_id, {"type": "progress", "phase": "synthesis", "error": synthesis_error})

        # ── PHASE 7: finalize ────────────────────────────────────────
        primary = side_summaries["A"]["stats"]
        duration_ms = int((time.monotonic() - started_mono) * 1000)

        db.finalize_eval_run(
            run_id,
            status="completed",
            cost_actual_usd=float(run["cost_preview_usd"]),
            cost_actual_tokens=int(run["cost_preview_tokens"]),
            duration_ms=duration_ms,
            diversity_score=side_summaries["A"]["diversity"],
            agg_overall_p50=primary["p50"],
            agg_overall_p10=primary["p10"],
            agg_overall_p90=primary["p90"],
            agg_overall_var=primary["var"],
            pair_winner=(pair_summary or {}).get("winner"),
            pair_winner_confidence=(pair_summary or {}).get("confidence"),
            judge_agreement_mean_abs=agreement_mean,
            synthesis_report_json=json.dumps(synthesis_report, ensure_ascii=False)
            if synthesis_report
            else None,
            synthesis_error=synthesis_error,
            meta_pipeline_json=meta_pipeline_str,
        )

        BUS.publish(
            run_id,
            {
                "type": "summary",
                "side_summaries": {
                    side: {
                        "stats": side_summaries[side]["stats"],
                        "diversity": side_summaries[side]["diversity"],
                    }
                    for side in sides
                },
                "pair": pair_summary,
            },
        )
        BUS.publish(
            run_id,
            {
                "type": "done",
                "status": "completed",
                "duration_ms": duration_ms,
            },
        )

    except Exception as exc:  # noqa: BLE001
        logger.exception("run %s failed", run_id)
        try:
            db.finalize_eval_run(run_id, status="failed", error=str(exc))
        except Exception:  # noqa: BLE001
            pass
        BUS.publish(run_id, {"type": "done", "status": "failed", "error": str(exc)})
    finally:
        with _REGISTRY_LOCK:
            EXECUTOR_REGISTRY.pop(int(run_id), None)


def _finalize_cancelled(db: DBManager, run_id: int, started_mono: float) -> None:
    duration_ms = int((time.monotonic() - started_mono) * 1000)
    db.finalize_eval_run(run_id, status="cancelled", duration_ms=duration_ms, error="cancelled by user")
    BUS.publish(run_id, {"type": "done", "status": "cancelled", "duration_ms": duration_ms})


def _run_pair_judge(
    *,
    client,
    run: dict,
    outputs: dict[str, list[dict]],
    cancel: threading.Event,
    parallelism: int,
    run_id: int,
) -> dict | None:
    """Run K pair-judge comparisons; pair output_a[i] with output_b[i]."""
    K = int(run["pair_judge_samples"])
    pa = {o["run_index"]: o for o in outputs["A"] if o["status"] == "ok"}
    pb = {o["run_index"]: o for o in outputs["B"] if o["status"] == "ok"}
    common = sorted(set(pa.keys()) & set(pb.keys()))
    if not common:
        return None

    pairs = [(common[k % len(common)],) for k in range(K)]
    votes: list[dict] = []
    with ThreadPoolExecutor(max_workers=min(parallelism, K), thread_name_prefix=f"eval-{run_id}-pair") as pool:
        futs = []
        for (idx,) in pairs:
            if cancel.is_set():
                break
            futs.append(
                pool.submit(
                    judge_pair,
                    client=client,
                    judge_model_id=run["judge_model_id"],
                    rubric=run["rubric_snapshot"],
                    prompt_a_text=run["prompt_a_text"],
                    prompt_b_text=run["prompt_b_text"],
                    task_input=run["task_input"],
                    output_a=pa[idx]["output_text"],
                    output_b=pb[idx]["output_text"],
                    reference_answer=run.get("reference_answer"),
                )
            )
        for f in futs:
            v = f.result()
            votes.append(v)
            BUS.publish(
                run_id,
                {
                    "type": "progress",
                    "phase": "pair_judge",
                    "winner": v.get("winner"),
                    "confidence": v.get("confidence"),
                },
            )
    if not votes:
        return None
    return pair_winner_summary(votes)
