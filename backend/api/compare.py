"""A/B Compare — generate with two technique sets."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.abuse import check_input_size, check_rate_limit
from backend.deps import get_current_user, get_db, get_registry_for_user, get_session_id
from core.context_builder import ContextBuilder
from core.parsing import parse_reply
from core.quality_metrics import analyze_prompt
from core.task_classifier import classify_task
from db.manager import DBManager
from services.api_key_resolver import resolve_openrouter_api_key
from services.llm_client import LLMClient, DEFAULT_PROVIDER

router = APIRouter()


def get_llm() -> LLMClient:
    api_key = resolve_openrouter_api_key()
    if not api_key:
        raise HTTPException(500, "OpenRouter API key not set. Use Settings or OPENROUTER_API_KEY env.")
    return LLMClient(api_key)

def _score(metrics: dict) -> float:
    return float(metrics.get("completeness_score", metrics.get("quality_score", 0.0)))


class CompareRequest(BaseModel):
    task_input: str
    gen_model: str = DEFAULT_PROVIDER
    target_model: str = "unknown"
    temperature: float = 0.7
    top_p: float | None = 1.0
    techs_a_mode: str = "auto"
    techs_a_manual: list[str] = []
    techs_b_mode: str = "auto"
    techs_b_manual: list[str] = []


@router.post("/compare")
def compare_prompts(
    req: CompareRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
    registry = Depends(get_registry_for_user),
    auth_session_id: str | None = Depends(get_session_id),
):
    """Generate two prompts with different technique sets and return both."""
    ok, err = check_input_size(req.task_input)
    if not ok:
        raise HTTPException(400, err)
    ok, err = check_rate_limit(auth_session_id or str(user["id"]))
    if not ok:
        raise HTTPException(429, err)

    llm = get_llm()
    builder = ContextBuilder(registry)

    classification = classify_task(req.task_input)
    task_types = classification["task_types"]
    complexity = classification["complexity"]

    def resolve_techs(mode: str, manual: list[str], exclude_ids: set[str] | None = None) -> list:
        if mode == "manual" and manual:
            return [t for t in (registry.get(tid) for tid in manual) if t]
        candidates = registry.select_techniques(task_types, complexity, 6, req.target_model)
        if exclude_ids:
            distinct = [t for t in candidates if t["id"] not in exclude_ids]
            if distinct:
                return distinct[:3]
        return candidates[:3]

    techniques_a = resolve_techs(req.techs_a_mode, req.techs_a_manual)
    techniques_b = resolve_techs(req.techs_b_mode, req.techs_b_manual, exclude_ids={t["id"] for t in techniques_a})
    ids_a = [t["id"] for t in techniques_a]
    ids_b = [t["id"] for t in techniques_b]

    if not ids_a or not ids_b:
        raise HTTPException(400, "Failed to resolve techniques for one of the variants")
    if ids_a == ids_b:
        raise HTTPException(400, "Variants A and B resolved to identical technique sets")

    user_content = builder.build_user_content(req.task_input, task_classification=classification)

    # Generate A
    system_a = builder.build_system_prompt(technique_ids=ids_a, target_model=req.target_model)
    result_a_text = ""
    for chunk in llm.stream(system_a, user_content, req.gen_model, req.temperature, top_p=req.top_p):
        result_a_text += chunk

    # Generate B
    system_b = builder.build_system_prompt(technique_ids=ids_b, target_model=req.target_model)
    result_b_text = ""
    for chunk in llm.stream(system_b, user_content, req.gen_model, req.temperature, top_p=req.top_p):
        result_b_text += chunk

    parsed_a = parse_reply(result_a_text)
    parsed_b = parse_reply(result_b_text)
    prompt_a = parsed_a.get("prompt_block") or result_a_text
    prompt_b = parsed_b.get("prompt_block") or result_b_text

    metrics_a = analyze_prompt(prompt_a)
    metrics_b = analyze_prompt(prompt_b)
    score_a = _score(metrics_a)
    score_b = _score(metrics_b)
    winner = "a" if score_a > score_b else "b" if score_b > score_a else "tie"

    db.log_event(
        event_name="compare_run",
        session_id=auth_session_id or "",
        payload={
            "task_types": task_types,
            "complexity": complexity,
            "techniques_a": ids_a,
            "techniques_b": ids_b,
            "score_a": score_a,
            "score_b": score_b,
        },
        user_id=int(user["id"]),
    )

    return {
        "a": {
            "prompt": prompt_a,
            "reasoning": parsed_a.get("reasoning", ""),
            "techniques": [{"id": t["id"], "name": t.get("name", t["id"])} for t in techniques_a],
            "metrics": metrics_a,
        },
        "b": {
            "prompt": prompt_b,
            "reasoning": parsed_b.get("reasoning", ""),
            "techniques": [{"id": t["id"], "name": t.get("name", t["id"])} for t in techniques_b],
            "metrics": metrics_b,
        },
        "winner": winner,
    }
