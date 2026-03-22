"""One-shot meta-improvement of a prompt (simple mode)."""
from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from config.abuse import check_input_size, check_rate_limit
from config.settings import TRIAL_MAX_COMPLETION_PER_M, TRIAL_TOKENS_LIMIT
from backend.deps import get_current_user, get_db, get_session_id
from core.simple_improve import (
    build_simple_improve_system_prompt,
    build_simple_improve_user_message,
    normalize_preset,
)
from db.manager import DBManager
from services.api_key_resolver import resolve_openrouter_api_key
from services.llm_client import LLMClient, DEFAULT_PROVIDER, PROVIDER_MODELS
from services.openrouter_models import get_model_pricing, completion_price_per_m
from services.user_preferences import get_user_preferences_payload

router = APIRouter()


def _get_openrouter_model_id(provider: str) -> str:
    if provider in PROVIDER_MODELS:
        return PROVIDER_MODELS[provider]
    return provider if "/" in provider else provider


class SimpleImproveRequest(BaseModel):
    prompt_text: str
    gen_model: str | None = None
    preset: str | None = None


class SimpleImproveResponse(BaseModel):
    improved_text: str
    preset_used: str
    gen_model: str


@router.post("/simple-improve", response_model=SimpleImproveResponse)
def simple_improve(
    req: SimpleImproveRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
    auth_session_id: str | None = Depends(get_session_id),
):
    text = (req.prompt_text or "").strip()
    if not text:
        raise HTTPException(400, "Пустой промпт.")
    ok, err = check_input_size(text)
    if not ok:
        raise HTTPException(400, err)
    ok, err = check_rate_limit(auth_session_id or str(user["id"]))
    if not ok:
        raise HTTPException(429, err)

    user_id = int(user["id"])
    user_key = db.get_user_openrouter_api_key(user_id)
    api_key = resolve_openrouter_api_key(user_key)
    if not api_key:
        raise HTTPException(
            500,
            "OpenRouter API key not set. Введите свой ключ в Настройках или настройте OPENROUTER_API_KEY на сервере.",
        )

    using_host_key = not bool(user_key)
    prefs_row = db.get_user_preferences(user_id)
    payload = get_user_preferences_payload(db, user_id)
    gen_list = payload.get("preferred_generation_models") or []
    gen_model = (req.gen_model or "").strip() or (gen_list[0] if gen_list else DEFAULT_PROVIDER)

    if using_host_key:
        usage = db.get_user_usage(user_id)
        if usage["tokens_used"] >= TRIAL_TOKENS_LIMIT:
            raise HTTPException(
                402,
                f"Пробный лимит ({TRIAL_TOKENS_LIMIT:,} токенов) исчерпан. Введите свой API ключ OpenRouter в Настройках.",
            )
        model_id = _get_openrouter_model_id(gen_model)
        if completion_price_per_m(model_id) > TRIAL_MAX_COMPLETION_PER_M:
            raise HTTPException(
                403,
                f"Модель недоступна в пробном режиме (выход >${TRIAL_MAX_COMPLETION_PER_M}/1M). "
                "Введите свой API ключ в Настройках.",
            )

    preset_src = req.preset if req.preset is not None else prefs_row.get("simple_improve_preset")
    preset_used = normalize_preset(str(preset_src) if preset_src is not None else None)
    custom_meta = str(prefs_row.get("simple_improve_meta") or "")
    system_prompt = build_simple_improve_system_prompt(preset_used, custom_meta)
    user_message = build_simple_improve_user_message(text)

    llm = LLMClient(api_key)
    db.log_event(
        "simple_improve_requested",
        session_id=auth_session_id or "",
        payload={"preset": preset_used, "gen_model": gen_model},
        user_id=user_id,
    )
    started = time.perf_counter()
    improved = llm.generate(
        system_prompt,
        user_message,
        gen_model,
        temperature=0.35,
        top_p=0.95,
    )
    improved = (improved or "").strip()
    latency_ms = round((time.perf_counter() - started) * 1000, 1)

    if using_host_key:
        model_id = _get_openrouter_model_id(gen_model)
        prompt_chars = len(system_prompt) + len(user_message)
        prompt_tokens_est = max(1, prompt_chars // 4)
        completion_tokens_est = max(1, len(improved) // 4)
        prompt_price, comp_price = get_model_pricing(model_id)
        cost = (prompt_tokens_est * prompt_price) + (completion_tokens_est * comp_price)
        db.add_user_usage(user_id, prompt_tokens_est + completion_tokens_est, cost)

    db.log_event(
        "simple_improve_success",
        session_id=auth_session_id or "",
        payload={
            "preset": preset_used,
            "gen_model": gen_model,
            "latency_ms": latency_ms,
            "output_chars": len(improved),
        },
        user_id=user_id,
    )

    return SimpleImproveResponse(
        improved_text=improved,
        preset_used=preset_used,
        gen_model=gen_model,
    )
