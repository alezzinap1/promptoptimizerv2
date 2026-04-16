"""
Перевод промпта / скилла между русским и английским одной кнопкой.

- Использует fast-тир через `services.model_router`.
- Учитывает rate-limit (`check_user_rate_limit`) и пробный лимит токенов.
- Сохраняет структуру (YAML frontmatter, заголовки, markdown, code-блоки).
"""
from __future__ import annotations

import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.deps import check_user_rate_limit, get_current_user, get_db, get_session_id
from config.abuse import check_input_size
from config.settings import TRIAL_MAX_COMPLETION_PER_M
from db.manager import DBManager
from services.api_key_resolver import resolve_openrouter_api_key
from services.llm_client import LLMClient
from services.model_router import resolve as resolve_model
from services.openrouter_models import completion_price_per_m, get_model_pricing
from services.trial_budget import effective_trial_tokens_limit

router = APIRouter()

Direction = Literal["ru->en", "en->ru", "auto"]
Kind = Literal["prompt", "skill", "plain"]


class TranslateRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=64_000)
    direction: Direction = "auto"
    kind: Kind = "prompt"


class TranslateResponse(BaseModel):
    translated: str
    direction: Direction
    detected_language: str | None = None
    model_used: str


_SYSTEM_PROMPTS: dict[Kind, str] = {
    "prompt": (
        "Ты профессиональный переводчик prompt-engineering текстов. Переведи промпт между русским и английским, "
        "сохраняя секции (например ROLE, TASK, RULES, OUTPUT), заголовки markdown, списки, code-блоки, XML-теги, "
        "плейсхолдеры вида {var}, JSON-структуры и специальные токены. НИЧЕГО не добавляй и не комментируй, "
        "возвращай только переведённый промпт в той же разметке."
    ),
    "skill": (
        "Ты переводишь SKILL-инструкцию для LLM-агента. Сохраняй YAML frontmatter (---...---), заголовки "
        "(## Role, ## Rules, ...), буллеты, примеры, code-блоки и имена инструментов без перевода. "
        "Переводи только человекочитаемые тексты. Отвечай только телом скилла."
    ),
    "plain": (
        "Ты профессиональный переводчик. Переведи текст между русским и английским в нейтральном стиле, "
        "сохраняя абзацы. Отвечай только переводом."
    ),
}


def _detect_direction(text: str, direction: Direction) -> tuple[Direction, str]:
    if direction != "auto":
        return direction, "ru" if direction == "ru->en" else "en"
    cyr = sum(1 for ch in text if "а" <= ch.lower() <= "я" or ch.lower() in "ёіїєґ")
    lat = sum(1 for ch in text if "a" <= ch.lower() <= "z")
    if cyr > lat:
        return "ru->en", "ru"
    return "en->ru", "en"


@router.post("/translate", response_model=TranslateResponse)
def translate_text(
    req: TranslateRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
    auth_session_id: str | None = Depends(get_session_id),
):
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(400, "Пустой текст.")
    ok, err = check_input_size(text)
    if not ok:
        raise HTTPException(400, err)
    ok, err = check_user_rate_limit(db, int(user["id"]), auth_session_id)
    if not ok:
        raise HTTPException(429, err)

    user_id = int(user["id"])
    user_key = db.get_user_openrouter_api_key(user_id)
    api_key = resolve_openrouter_api_key(user_key)
    if not api_key:
        raise HTTPException(500, "OpenRouter API key not set.")
    using_host_key = not bool(user_key)
    if using_host_key:
        usage = db.get_user_usage(user_id)
        lim = effective_trial_tokens_limit(usage)
        if usage["tokens_used"] >= lim:
            raise HTTPException(
                402,
                f"Пробный лимит ({lim:,} токенов) исчерпан. Введите свой API ключ в Настройках.",
            )

    direction, detected = _detect_direction(text, req.direction)
    model_id, _ = resolve_model(db, "fast", "text", trial=using_host_key)
    if not model_id:
        raise HTTPException(503, "Нет доступных моделей для перевода. Попробуйте позже.")
    if using_host_key and completion_price_per_m(model_id) > TRIAL_MAX_COMPLETION_PER_M:
        raise HTTPException(403, "Перевод недоступен в пробном режиме: дороже лимита.")

    target_lang_human = "английский" if direction == "ru->en" else "русский"
    user_content = (
        f"Переведи следующий {req.kind} на {target_lang_human}. "
        f"Сохрани разметку и структуру один-в-один.\n\n---\n{text}"
    )

    llm = LLMClient(api_key, timeout=60.0)
    started = time.perf_counter()
    translated = llm.generate(
        system_prompt=_SYSTEM_PROMPTS[req.kind],
        user_content=user_content,
        provider=model_id,
        temperature=0.2,
        top_p=0.9,
        max_tokens=min(6000, max(512, len(text) // 2 + 512)),
    )
    translated = (translated or "").strip()
    if not translated:
        raise HTTPException(502, "Пустой ответ модели.")

    if using_host_key:
        pp, cp = get_model_pricing(model_id)
        prompt_tokens = len(text) // 4 + 120
        completion_tokens = len(translated) // 4
        total_tokens = prompt_tokens + completion_tokens
        cost = prompt_tokens * pp + completion_tokens * cp
        db.add_user_usage(user_id, total_tokens, cost)

    db.log_event(
        "translate",
        session_id=auth_session_id or "",
        payload={
            "direction": direction,
            "kind": req.kind,
            "model": model_id,
            "input_len": len(text),
            "output_len": len(translated),
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
        },
        user_id=user_id,
    )

    return TranslateResponse(
        translated=translated,
        direction=direction,
        detected_language=detected,
        model_used=model_id,
    )
