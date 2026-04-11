"""Универсальная песочница: system = текст промпта/инструкции, user = тестовый ввод."""
from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from config.abuse import check_input_size, check_rate_limit
from config.settings import TRIAL_MAX_COMPLETION_PER_M, TRIAL_TOKENS_LIMIT
from backend.deps import get_current_user, get_db, get_session_id
from db.manager import DBManager
from services.llm_client import LLMClient, DEFAULT_PROVIDER, PROVIDER_MODELS
from services.api_key_resolver import resolve_openrouter_api_key
from services.openrouter_models import completion_price_per_m, get_model_pricing
from services.user_preferences import get_user_preferences_payload

router = APIRouter()

_GEN_TEMP_CAP = 0.85


def _get_openrouter_model_id(provider: str) -> str:
    if provider in PROVIDER_MODELS:
        return PROVIDER_MODELS[provider]
    return provider if "/" in provider else provider


class PlaygroundRunRequest(BaseModel):
    prompt_text: str = Field("", max_length=120_000)
    user_input: str = Field("", max_length=32_000)
    gen_model: str | None = None
    temperature: float = 0.5


class PlaygroundRunResponse(BaseModel):
    reply: str
    gen_model: str


@router.post("/playground/run", response_model=PlaygroundRunResponse)
def playground_run(
    req: PlaygroundRunRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
    auth_session_id: str | None = Depends(get_session_id),
):
    system = (req.prompt_text or "").strip()
    msg = (req.user_input or "").strip()
    if not system:
        raise HTTPException(400, "Пустой prompt_text.")
    if not msg:
        raise HTTPException(400, "Пустой user_input.")
    blob = f"{system}\n{msg}"
    ok, err = check_input_size(blob)
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
    if using_host_key:
        usage = db.get_user_usage(user_id)
        if usage["tokens_used"] >= TRIAL_TOKENS_LIMIT:
            raise HTTPException(
                402,
                f"Пробный лимит ({TRIAL_TOKENS_LIMIT:,} токенов) исчерпан. Введите свой API ключ OpenRouter в Настройках.",
            )

    payload = get_user_preferences_payload(db, user_id)
    gen_list = payload.get("preferred_generation_models") or []
    gen_model = (req.gen_model or "").strip() or (gen_list[0] if gen_list else DEFAULT_PROVIDER)
    if using_host_key:
        model_id = _get_openrouter_model_id(gen_model)
        if completion_price_per_m(model_id) > TRIAL_MAX_COMPLETION_PER_M:
            raise HTTPException(
                403,
                f"Модель недоступна в пробном режиме (выход >${TRIAL_MAX_COMPLETION_PER_M}/1M). "
                "Введите свой API ключ в Настройках.",
            )

    llm = LLMClient(api_key, timeout=90.0)
    started = time.perf_counter()
    temp = min(float(req.temperature), _GEN_TEMP_CAP)
    reply = llm.generate(
        system_prompt=system,
        user_content=msg,
        provider=gen_model,
        temperature=temp,
        top_p=0.95,
        max_tokens=2048,
    )
    reply = (reply or "").strip()
    if not reply:
        raise HTTPException(502, "Пустой ответ модели.")

    if using_host_key:
        prompt_tokens = int(len(system + msg) // 4) + 80
        completion_tokens = max(0, len(reply) // 4)
        total_tokens = prompt_tokens + completion_tokens
        mid = _get_openrouter_model_id(gen_model)
        pp, cp = get_model_pricing(mid)
        cost = (prompt_tokens * pp) + (completion_tokens * cp)
        db.add_user_usage(user_id, total_tokens, cost)

    db.log_event(
        "playground_run",
        session_id=auth_session_id or "",
        payload={"gen_model": gen_model, "latency_ms": round((time.perf_counter() - started) * 1000, 1)},
        user_id=user_id,
    )
    return PlaygroundRunResponse(reply=reply, gen_model=gen_model)
