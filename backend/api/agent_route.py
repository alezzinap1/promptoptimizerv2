"""Семантическая маршрутизация намерений агента студии."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from backend.deps import get_current_user
from config.settings import SEMANTIC_ROUTE_MIN_CONFIDENCE, SEMANTIC_ROUTE_MIN_MARGIN
from services.semantic_agent_router import route_intent

router = APIRouter()


class SemanticRouteRequest(BaseModel):
    text: str = Field("", max_length=4000)
    has_prompt: bool = True


@router.post("/agent/semantic-route")
def semantic_route(
    req: SemanticRouteRequest,
    _user: dict = Depends(get_current_user),
):
    """
    Классификация намерения по короткому тексту (после появления промпта).
    Клиент при intent=None или низкой уверенности использует rule-based fallback.
    """
    out = route_intent(req.text, has_prompt=req.has_prompt)
    intent = out.get("intent")
    conf = float(out.get("confidence") or 0.0)
    margin = float(out.get("margin") or 0.0)
    if intent and (conf < SEMANTIC_ROUTE_MIN_CONFIDENCE or margin < SEMANTIC_ROUTE_MIN_MARGIN):
        out = {**out, "intent": None, "rejected_reason": "below_threshold"}
    return out
