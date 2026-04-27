"""OpenRouter models API — list models with pricing, cached 24h."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from config.settings import TRIAL_MAX_COMPLETION_PER_M
from backend.deps import get_current_user, get_db
from db.manager import DBManager
from services.openrouter_models import get_models

router = APIRouter()


@router.get("/models")
def list_models(
    refresh: bool = Query(False, description="Force refresh from OpenRouter"),
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    """Return OpenRouter models. If user has no API key, only trial-allowed models (completion <= TRIAL_MAX_COMPLETION_PER_M)."""
    result = get_models(force_refresh=refresh)
    user_key = db.get_user_openrouter_api_key(int(user["id"]))
    if not user_key:
        max_comp = TRIAL_MAX_COMPLETION_PER_M
        data = [m for m in result.get("data", []) if _completion_per_m(m) <= max_comp]
        result = {**result, "data": data, "trial_mode": True}
    else:
        result = {**result, "trial_mode": False}
    return result


def _completion_per_m(m: dict) -> float:
    p = m.get("pricing") or {}
    comp = p.get("completion") or p.get("output") or 0
    return float(comp) * 1_000_000 if comp else 0.0
