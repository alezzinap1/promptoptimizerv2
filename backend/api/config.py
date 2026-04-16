"""Config endpoints — domains, model tiers."""
from __future__ import annotations

from fastapi import APIRouter

from core.domain_templates import get_domain_list
from services.model_router import visible_tiers_for_ui

router = APIRouter()


@router.get("/domains")
def get_domains():
    domains = get_domain_list()
    return {"domains": [{"id": d[0], "name": d[1]} for d in domains]}


@router.get("/model-tiers")
def get_model_tiers():
    """Список тиров для UI. Имена моделей намеренно не раскрываем."""
    return {"tiers": visible_tiers_for_ui()}
