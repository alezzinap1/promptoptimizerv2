"""Unauthenticated public endpoints (landing widgets)."""
from __future__ import annotations

import time

from fastapi import APIRouter, Depends

from backend.deps import get_db
from core.model_catalog import candidates
from db.manager import DBManager
from services.model_health import ensure_fresh, pick_first_available

router = APIRouter()

_CACHE: dict = {"at": 0.0, "payload": None}
_CACHE_TTL_SEC = 300

_PUBLIC_SLOTS: list[tuple[str, str, str]] = [
    ("auto", "text", "fast"),
    ("fast", "text", "fast"),
    ("mid", "text", "mid"),
    ("advanced", "text", "advanced"),
    ("auto", "vision", "fast"),
    ("advanced", "vision", "advanced"),
]


def _slot_status(db: DBManager, mode: str, tier: str) -> str:
    """ok | degraded | down — no model slugs exposed."""
    if pick_first_available(db, mode, tier):
        return "ok"
    ids = candidates(mode, tier)  # type: ignore[arg-type]
    if not ids:
        return "down"
    return "degraded"


def _build_snapshot(db: DBManager) -> dict:
    ensure_fresh(db, max_age_sec=24 * 60 * 60)
    cells: dict[str, str] = {}
    for label_tier, mode, resolve_tier in _PUBLIC_SLOTS:
        key = f"{label_tier}_{mode}"
        cells[key] = _slot_status(db, mode, resolve_tier)
    return {"cells": cells, "cached": True}


@router.get("/public/model-health-snapshot")
def model_health_snapshot(db: DBManager = Depends(get_db)):
    """
    Sanitised tier/mode health for the marketing trust widget.
    Cached in-process for 5 minutes. No OpenRouter model IDs.
    """
    now = time.time()
    if _CACHE["payload"] is not None and now - float(_CACHE["at"]) < _CACHE_TTL_SEC:
        return _CACHE["payload"]
    payload = _build_snapshot(db)
    _CACHE["at"] = now
    _CACHE["payload"] = payload
    return payload
