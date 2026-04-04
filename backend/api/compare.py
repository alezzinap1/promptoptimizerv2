"""A/B Compare — generate with two technique sets."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from config.abuse import check_input_size, check_rate_limit
from config.settings import TRIAL_TOKENS_LIMIT, TRIAL_MAX_COMPLETION_PER_M
from backend.deps import get_current_user, get_db, get_registry_for_user, get_session_id
from core.compare_judge import run_compare_judge
from core.context_builder import ContextBuilder
from core.parsing import parse_reply
from core.model_taxonomy import ModelType, classify_model, SUPPRESS_FOR_REASONING
from core.quality_metrics import analyze_prompt
from core.task_classifier import classify_task
from db.manager import DBManager
from services.api_key_resolver import resolve_openrouter_api_key
from services.llm_client import LLMClient, DEFAULT_PROVIDER, PROVIDER_MODELS
from services.openrouter_models import get_model_pricing, completion_price_per_m

router = APIRouter()


def _get_openrouter_model_id(provider: str) -> str:
    if provider in PROVIDER_MODELS:
        return PROVIDER_MODELS[provider]
    return provider if "/" in provider else provider

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
    prompt_type: str = "text"


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

    user_id = int(user["id"])
    user_key = db.get_user_openrouter_api_key(user_id)
    api_key = resolve_openrouter_api_key(user_key)
    if not api_key:
        raise HTTPException(500, "OpenRouter API key not set. Введите свой ключ в Настройках.")
    using_host_key = not bool(user_key)
    if using_host_key:
        usage = db.get_user_usage(user_id)
        if usage["tokens_used"] >= TRIAL_TOKENS_LIMIT:
            raise HTTPException(402, f"Пробный лимит ({TRIAL_TOKENS_LIMIT:,} токенов) исчерпан. Введите свой API ключ в Настройках.")
        model_id = _get_openrouter_model_id(req.gen_model)
        if completion_price_per_m(model_id) > TRIAL_MAX_COMPLETION_PER_M:
            raise HTTPException(403, f"Модель недоступна в пробном режиме. Введите свой API ключ в Настройках.")

    llm = LLMClient(api_key)
    builder = ContextBuilder(registry)

    classification = classify_task(req.task_input)
    task_types = classification["task_types"]
    complexity = classification["complexity"]

    def resolve_techs(mode: str, manual: list[str], exclude_ids: set[str] | None = None) -> list:
        if mode == "manual" and manual:
            return [t for t in (registry.get(tid) for tid in manual) if t]
        candidates = registry.select_techniques(
            task_types,
            complexity,
            6,
            req.target_model,
            user_input=req.task_input,
            prompt_type=req.prompt_type or "text",
        )
        if classify_model(req.target_model) == ModelType.REASONING:
            candidates = [t for t in candidates if t["id"] not in SUPPRESS_FOR_REASONING]
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

    metrics_a = analyze_prompt(
        prompt_a, req.target_model, prompt_type=req.prompt_type or "text", task_input=req.task_input,
    )
    metrics_b = analyze_prompt(
        prompt_b, req.target_model, prompt_type=req.prompt_type or "text", task_input=req.task_input,
    )
    score_a = _score(metrics_a)
    score_b = _score(metrics_b)
    winner = "a" if score_a > score_b else "b" if score_b > score_a else "tie"

    if using_host_key:
        model_id = _get_openrouter_model_id(req.gen_model)
        prompt_price, comp_price = get_model_pricing(model_id)
        input_len = len(system_a) + len(system_b) + 2 * len(user_content)
        output_len = len(result_a_text) + len(result_b_text)
        total_tokens = input_len // 4 + output_len // 4
        cost = (input_len // 4) * prompt_price + (output_len // 4) * comp_price
        db.add_user_usage(user_id, total_tokens, cost)

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
        user_id=user_id,
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
        "winner_heuristic_note": (
            "Победитель по внутренней эвристике (полнота и метрики текста), не вердикт LLM. "
            "Ниже можно вызвать LLM-судью."
        ),
    }


class CompareJudgeRequest(BaseModel):
    task_input: str
    prompt_a: str
    prompt_b: str
    judge_model: str = "gemini_flash"


@router.post("/compare/judge")
def compare_llm_judge(
    req: CompareJudgeRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
    auth_session_id: str | None = Depends(get_session_id),
):
    """Отдельный вызов LLM-as-judge для двух промптов."""
    ok, err = check_input_size(req.task_input)
    if not ok:
        raise HTTPException(400, err)
    ok, err = check_rate_limit(auth_session_id or str(user["id"]))
    if not ok:
        raise HTTPException(429, err)

    user_id = int(user["id"])
    user_key = db.get_user_openrouter_api_key(user_id)
    api_key = resolve_openrouter_api_key(user_key)
    if not api_key:
        raise HTTPException(500, "OpenRouter API key not set. Введите свой ключ в Настройках.")

    using_host_key = not bool(user_key)
    judge = (req.judge_model or "gemini_flash").strip()
    if using_host_key:
        usage = db.get_user_usage(user_id)
        if usage["tokens_used"] >= TRIAL_TOKENS_LIMIT:
            raise HTTPException(402, "Пробный лимит токенов исчерпан. Введите свой API ключ.")
        mid = _get_openrouter_model_id(judge)
        if completion_price_per_m(mid) > TRIAL_MAX_COMPLETION_PER_M:
            raise HTTPException(403, "Модель судьи недоступна в пробном режиме. Укажите дешёвую модель или свой ключ.")

    llm = LLMClient(api_key)
    result = run_compare_judge(
        llm,
        judge,
        req.task_input,
        req.prompt_a,
        req.prompt_b,
    )

    if using_host_key:
        model_id = _get_openrouter_model_id(judge)
        inp = len(req.task_input) + len(req.prompt_a) + len(req.prompt_b) + 2000
        out = len(result.get("reasoning") or "") + 200
        pr, cp = get_model_pricing(model_id)
        db.add_user_usage(user_id, (inp + out) // 4, ((inp + out) // 4) * (pr + cp))

    db.log_event(
        "compare_judge",
        session_id=auth_session_id or "",
        payload={"winner": result.get("winner"), "judge_model": judge},
        user_id=user_id,
    )
    return result
