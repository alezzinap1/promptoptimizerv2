"""OpenRouter models API — list models with pricing, cached 24h."""
from __future__ import annotations

from fastapi import APIRouter, Query

from services.openrouter_models import get_models

router = APIRouter()


@router.get("/models")
def list_models(refresh: bool = Query(False, description="Force refresh from OpenRouter")):
    """Return OpenRouter models with pricing. Cached 24h unless refresh=true."""
    return get_models(force_refresh=refresh)
