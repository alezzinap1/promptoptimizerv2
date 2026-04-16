"""
Публичный демо-эндпоинт — без входа/регистрации.

Цель: показать «одну живую генерацию промпта» на лендинге /welcome для конверсии.

Ограничения (anti-abuse):
  - только fast-тир, жёсткий потолок max_tokens.
  - rate-limit по IP: 5 req/5мин + 20 req/сут.
  - ограничение входа (`check_input_size`).
  - ключ берётся от хоста; если его нет — возвращаем 503 с понятным текстом.
  - в БД ничего не пишется про пользователя; событие `demo_generate` пишется без user_id.
"""
from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from backend.deps import get_db
from config.abuse import check_demo_rate_limit, check_input_size, client_ip
from db.manager import DBManager
from services.api_key_resolver import resolve_openrouter_api_key
from services.llm_client import LLMClient
from services.model_router import resolve as resolve_model

router = APIRouter()


class DemoGenerateRequest(BaseModel):
    task: str = Field(..., min_length=3, max_length=2000)


class DemoGenerateResponse(BaseModel):
    prompt_block: str
    tier_used: str
    model_category: str  # «fast|mid|advanced» — без имени модели


_DEMO_SYSTEM = (
    "Ты — помощник prompt-engineer. На вход приходит короткая задача пользователя. "
    "Твоя задача — выдать аккуратный, готовый к использованию промпт в markdown-формате.\n\n"
    "Структура ответа (строго):\n"
    "## Роль\n<1–2 строки>\n\n"
    "## Задача\n<1–3 буллета>\n\n"
    "## Формат ответа\n<1–4 буллета>\n\n"
    "## Ограничения\n<1–3 буллета>\n\n"
    "Отвечай по-русски. Не добавляй вступлений и выводов. Объём всего промпта — до 300 слов."
)


@router.post("/demo/generate", response_model=DemoGenerateResponse)
def demo_generate(
    req: DemoGenerateRequest,
    request: Request,
    db: DBManager = Depends(get_db),
):
    task = (req.task or "").strip()
    if not task:
        raise HTTPException(400, "Пустой ввод.")
    ok, err = check_input_size(task)
    if not ok:
        raise HTTPException(400, err)
    ok, err = check_demo_rate_limit(request)
    if not ok:
        raise HTTPException(429, err)

    api_key = resolve_openrouter_api_key(None)
    if not api_key:
        raise HTTPException(503, "Демо временно недоступно: у сервиса нет API-ключа.")

    model_id, _reason = resolve_model(db, "fast", "text", trial=True)
    if not model_id:
        raise HTTPException(503, "Демо временно недоступно: нет подходящей модели.")

    llm = LLMClient(api_key, timeout=45.0)
    started = time.perf_counter()
    try:
        result = llm.generate(
            system_prompt=_DEMO_SYSTEM,
            user_content=f"Задача пользователя:\n{task}",
            provider=model_id,
            temperature=0.5,
            top_p=0.9,
            max_tokens=600,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Ошибка генерации: {exc}") from exc

    text = (result or "").strip()
    if not text:
        raise HTTPException(502, "Пустой ответ модели.")

    db.log_event(
        "demo_generate",
        session_id="",
        payload={
            "ip": client_ip(request),
            "chars_in": len(task),
            "chars_out": len(text),
            "model": model_id,
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
        },
        user_id=None,
    )
    return DemoGenerateResponse(
        prompt_block=text,
        tier_used="fast",
        model_category="fast",
    )
