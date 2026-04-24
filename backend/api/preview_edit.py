"""Inline preview edit — один короткий LLM-вызов без полного пайплайна техник."""
from __future__ import annotations

import re
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from config.abuse import check_input_size
from config.settings import TRIAL_MAX_COMPLETION_PER_M
from backend.deps import check_user_rate_limit, get_current_user, get_db, get_session_id
from services.trial_budget import effective_trial_tokens_limit
from db.manager import DBManager
from prompts import load_prompt
from services.api_key_resolver import resolve_openrouter_api_key
from services.llm_client import LLMClient, DEFAULT_PROVIDER, PROVIDER_MODELS
from services.openrouter_models import completion_price_per_m
from services.user_preferences import get_user_preferences_payload

router = APIRouter()

PREVIEW_EDIT_SYSTEM = load_prompt("backend/preview_edit_system.txt")
PREVIEW_EDIT_MAX_OUT = 8192


def _get_openrouter_model_id(provider: str) -> str:
    if provider in PROVIDER_MODELS:
        return PROVIDER_MODELS[provider]
    return provider if "/" in provider else provider


def _strip_fenced_output(raw: str) -> str:
    t = (raw or "").strip()
    if not t.startswith("```"):
        return t
    lines = t.split("\n")
    if len(lines) >= 2 and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


class PreviewEditRequest(BaseModel):
    task_input: str = Field("", max_length=32000)
    current_prompt: str = Field("", max_length=64000)
    instruction: str = Field("", max_length=8000)
    prompt_type: str = Field("text", max_length=32)
    gen_model: str | None = None


class PreviewEditResponse(BaseModel):
    new_prompt: str
    reasoning: str = ""


@router.post("/generate/preview-edit", response_model=PreviewEditResponse)
def preview_edit(
    req: PreviewEditRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
    auth_session_id: str | None = Depends(get_session_id),
):
    cur = (req.current_prompt or "").strip()
    ins = (req.instruction or "").strip()
    if not cur:
        raise HTTPException(400, "Пустой текущий промпт.")
    if not ins:
        raise HTTPException(400, "Пустая инструкция.")
    blob = f"{req.task_input}\n{cur}\n{ins}"
    ok, err = check_input_size(blob)
    if not ok:
        raise HTTPException(400, err)
    ok, err = check_user_rate_limit(db, int(user["id"]), auth_session_id)
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
        lim = effective_trial_tokens_limit(usage)
        if usage["tokens_used"] >= lim:
            raise HTTPException(
                402,
                f"Пробный лимит ({lim:,} токенов) исчерпан. Введите свой API ключ OpenRouter в Настройках.",
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

    user_msg = (
        f"Тип промпта: {req.prompt_type or 'text'}\n\n"
        f"Исходная задача (контекст):\n---\n{(req.task_input or '').strip() or '—'}\n---\n\n"
        f"Текущий промпт:\n---\n{cur}\n---\n\n"
        f"Инструкция по правке:\n---\n{ins}\n---"
    )
    llm = LLMClient(api_key, timeout=90.0)
    started = time.perf_counter()
    raw = llm.generate(
        PREVIEW_EDIT_SYSTEM,
        user_msg,
        gen_model,
        temperature=0.25,
        top_p=0.9,
        max_tokens=PREVIEW_EDIT_MAX_OUT,
    )
    new_prompt = _strip_fenced_output(raw)
    if not new_prompt.strip():
        raise HTTPException(502, "Модель вернула пустой текст.")
    if using_host_key:
        prompt_tokens = int(len(PREVIEW_EDIT_SYSTEM + user_msg) // 4) + 50
        completion_tokens = max(0, len(raw) // 4)
        total_tokens = prompt_tokens + completion_tokens
        from services.openrouter_models import get_model_pricing

        mid = _get_openrouter_model_id(gen_model)
        pp, cp = get_model_pricing(mid)
        cost = (prompt_tokens * pp) + (completion_tokens * cp)
        db.add_user_usage(user_id, total_tokens, cost)

    latency_ms = round((time.perf_counter() - started) * 1000, 1)
    db.log_event(
        "preview_edit",
        session_id=auth_session_id or "",
        payload={
            "gen_model": gen_model,
            "prompt_type": req.prompt_type,
            "latency_ms": latency_ms,
            "out_chars": len(new_prompt),
        },
        user_id=user_id,
    )
    short_reason = re.sub(r"\s+", " ", raw[:240]).strip()
    if len(raw) > 240:
        short_reason += "…"
    return PreviewEditResponse(new_prompt=new_prompt, reasoning=short_reason)
