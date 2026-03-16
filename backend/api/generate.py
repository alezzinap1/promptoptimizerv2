"""Prompt generation."""
from __future__ import annotations

import time
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from config.abuse import check_input_size, check_rate_limit
from config.settings import BUDGET_GENERATIONS_PER_SESSION
from backend.deps import get_current_user, get_db, get_registry_for_user, get_session_id
from core.context_builder import ContextBuilder
from core.domain_templates import get_domain_techniques
from core.parsing import parse_questions, parse_reply
from core.prompt_spec import build_generation_brief
from core.quality_metrics import analyze_prompt
from core.workspace_profile import normalize_workspace
from db.manager import DBManager
from services.api_key_resolver import resolve_openrouter_api_key
from services.llm_client import LLMClient, DEFAULT_PROVIDER
from services.prompt_workflow import (
    apply_evidence_decisions,
    build_preview_payload,
    resolve_techniques,
)

router = APIRouter()


def get_llm() -> LLMClient:
    api_key = resolve_openrouter_api_key()
    if not api_key:
        raise HTTPException(500, "OpenRouter API key not set. Use Settings or OPENROUTER_API_KEY env.")
    return LLMClient(api_key)

class GenerateRequest(BaseModel):
    task_input: str
    feedback: str = ""
    gen_model: str = DEFAULT_PROVIDER
    target_model: str = "unknown"
    domain: str = "auto"
    technique_mode: str = "auto"
    manual_techs: list[str] = []
    temperature: float = 0.7
    top_p: float | None = 1.0
    top_k: int | None = None
    questions_mode: bool = True
    session_id: str | None = None
    previous_prompt: str | None = None
    workspace_id: int | None = None
    prompt_spec_overrides: dict | None = None
    evidence_decisions: dict | None = None
    question_answers: list[dict] = []


def _check_session_budget(db: DBManager, user_id: int, auth_session_id: str | None) -> None:
    if not auth_session_id:
        return
    events = db.get_recent_events(limit=1000, user_id=user_id)
    used = sum(
        1
        for event in events
        if event.get("session_id") == auth_session_id
        and event.get("event_name") in {"generate_requested", "compare_run"}
    )
    if used >= BUDGET_GENERATIONS_PER_SESSION:
        raise HTTPException(
            429,
            f"Session generation budget ({BUDGET_GENERATIONS_PER_SESSION}) exhausted. Start a new session.",
        )


def _build_answers_text(question_answers: list[dict]) -> str:
    lines: list[str] = []
    for item in question_answers:
        question = str(item.get("question") or "").strip()
        answers = [str(v).strip() for v in (item.get("answers") or []) if str(v).strip()]
        if question and answers:
            lines.append(f"{question}: {', '.join(answers)}")
    return "\n".join(lines)


@router.post("/generate")
def generate_prompt(
    req: GenerateRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
    registry = Depends(get_registry_for_user),
    auth_session_id: str | None = Depends(get_session_id),
):
    """Generate prompt. Returns full result (LLM call is blocking)."""
    ok, err = check_input_size(req.task_input)
    if not ok:
        raise HTTPException(400, err)
    ok, err = check_rate_limit(auth_session_id or str(user["id"]))
    if not ok:
        raise HTTPException(429, err)
    _check_session_budget(db, int(user["id"]), auth_session_id)

    llm = get_llm()
    session_id = req.session_id or str(uuid.uuid4())
    workspace = None
    if req.workspace_id:
        workspace = db.get_workspace(req.workspace_id, user_id=int(user["id"]))
        if not workspace:
            raise HTTPException(404, f"Workspace {req.workspace_id} not found")

    db.log_event(
        event_name="generate_requested",
        session_id=auth_session_id or "",
        payload={
            "iteration_mode": bool(req.previous_prompt),
            "questions_mode": req.questions_mode,
            "technique_mode": req.technique_mode,
            "workspace_id": req.workspace_id or 0,
        },
        user_id=int(user["id"]),
    )

    effective_overrides = apply_evidence_decisions(req.prompt_spec_overrides, req.evidence_decisions)
    preview = build_preview_payload(
        raw_input=req.task_input,
        target_model=req.target_model,
        workspace=workspace,
        previous_prompt=req.previous_prompt,
        overrides=effective_overrides,
        registry=registry,
        technique_mode=req.technique_mode,
        manual_techs=req.manual_techs,
    )
    classification = preview["classification"]
    prompt_spec = preview["prompt_spec"]
    evidence = preview["evidence"]
    debug_issues = preview["debug_issues"]
    intent_graph = preview["intent_graph"]

    db.save_prompt_spec(
        session_id=session_id,
        raw_input=req.task_input,
        workspace_id=workspace.get("id") if workspace else None,
        spec=prompt_spec,
        evidence=evidence,
        issues=debug_issues,
        user_id=int(user["id"]),
    )

    techniques = resolve_techniques(
        registry=registry,
        classification=classification,
        target_model=req.target_model,
        technique_mode=req.technique_mode,
        manual_techs=req.manual_techs,
        max_techniques=4,
    )
    technique_ids = [t["id"] for t in techniques]

    if req.domain and req.domain != "auto" and req.technique_mode != "manual":
        domain_tech_ids = get_domain_techniques(req.domain)
        if domain_tech_ids:
            techniques = [t for t in (registry.get(tid) for tid in domain_tech_ids) if t]
            technique_ids = [t["id"] for t in techniques]

    builder = ContextBuilder(registry)

    combined_input = build_generation_brief(prompt_spec)
    if req.question_answers:
        answers_text = _build_answers_text(req.question_answers)
        if answers_text:
            combined_input += f"\n\nОтветы на уточняющие вопросы:\n{answers_text}"
    if req.feedback.strip():
        combined_input += f"\n\nКомментарий к улучшению: {req.feedback}"

    system_prompt = builder.build_system_prompt(
        technique_ids=technique_ids,
        target_model=req.target_model,
        domain=req.domain or "auto",
        questions_mode=req.questions_mode,
    )
    user_content = builder.build_user_content(
        combined_input,
        previous_agent_prompt=req.previous_prompt,
        task_classification=classification,
    )

    started_at = time.perf_counter()
    full_text = ""
    for chunk in llm.stream(
        system_prompt,
        user_content,
        req.gen_model,
        req.temperature,
        top_p=req.top_p,
        top_k=req.top_k,
    ):
        full_text += chunk

    parsed = parse_reply(full_text)
    questions = parse_questions(parsed.get("questions_raw", "")) or []
    metrics = analyze_prompt(parsed.get("prompt_block", "")) if parsed.get("has_prompt") else {}
    latency_ms = round((time.perf_counter() - started_at) * 1000, 1)
    outcome = "prompt" if parsed.get("has_prompt") else "questions" if parsed.get("has_questions") else "raw_text"

    db.log_event(
        "generation_result",
        session_id=auth_session_id or "",
        payload={
            "outcome": outcome,
            "gen_model": req.gen_model,
            "target_model": req.target_model,
            "latency_ms": latency_ms,
            "technique_ids": technique_ids,
            "completeness_score": metrics.get("completeness_score", 0.0),
        },
        user_id=int(user["id"]),
    )

    if parsed.get("has_prompt"):
        db.save_prompt_version(
            session_id=session_id,
            task_input=req.task_input,
            task_types=classification["task_types"],
            complexity=classification["complexity"],
            target_model=req.target_model,
            gen_model=req.gen_model,
            techniques_used=technique_ids,
            reasoning=parsed.get("reasoning", ""),
            final_prompt=parsed["prompt_block"],
            metrics=metrics,
            user_id=int(user["id"]),
        )
        db.log_event(
            "generate_prompt_success",
            session_id=auth_session_id or "",
            payload={
                "target_model": req.target_model,
                "gen_model": req.gen_model,
                "completeness_score": metrics.get("completeness_score", 0.0),
                "workspace_id": workspace.get("id") if workspace else None,
                "debug_issue_count": len(debug_issues),
            },
            user_id=int(user["id"]),
        )
    elif parsed.get("has_questions"):
        db.log_event(
            "generate_questions",
            session_id=auth_session_id or "",
            payload={
                "target_model": req.target_model,
                "gen_model": req.gen_model,
                "question_count": len(questions),
            },
            user_id=int(user["id"]),
        )
    else:
        db.log_event(
            "generate_raw_text",
            session_id=auth_session_id or "",
            payload={"target_model": req.target_model, "gen_model": req.gen_model},
            user_id=int(user["id"]),
        )

    return {
        **parsed,
        "questions": questions,
        "techniques": [{"id": t["id"], "name": t.get("name", t["id"])} for t in techniques],
        "technique_ids": technique_ids,
        "task_types": classification["task_types"],
        "complexity": classification["complexity"],
        "task_input": req.task_input,
        "gen_model": req.gen_model,
        "target_model": req.target_model,
        "metrics": metrics,
        "prompt_spec": prompt_spec,
        "evidence": evidence,
        "debug_issues": debug_issues,
        "intent_graph": intent_graph,
        "workspace": normalize_workspace(workspace),
        "session_id": session_id,
    }
