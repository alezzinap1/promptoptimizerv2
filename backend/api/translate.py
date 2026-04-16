"""
Перевод RU↔EN без вызовов LLM.

Используется бесплатный сервис (MyMemory → Lingva) через `services.translator`.
Учитывает rate-limit, чтобы не ловить ban от публичных API. Пробный лимит токенов
НЕ уменьшается — перевод бесплатный для пользователя.
"""
from __future__ import annotations

import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.deps import check_user_rate_limit, get_current_user, get_db, get_session_id
from config.abuse import check_input_size
from db.manager import DBManager
from services import translator

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
    provider: str


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
    started = time.perf_counter()
    try:
        result = translator.translate(text, req.direction)
    except RuntimeError as exc:
        raise HTTPException(503, f"Перевод временно недоступен: {exc}") from exc

    db.log_event(
        "translate",
        session_id=auth_session_id or "",
        payload={
            "direction": result["direction"],
            "detected": result.get("detected_language"),
            "kind": req.kind,
            "provider": result.get("provider"),
            "chars_in": len(text),
            "chars_out": len(result["translated"]),
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
        },
        user_id=user_id,
    )

    return TranslateResponse(
        translated=result["translated"],
        direction=result["direction"],  # type: ignore[arg-type]
        detected_language=result.get("detected_language"),
        provider=str(result.get("provider") or "unknown"),
    )
