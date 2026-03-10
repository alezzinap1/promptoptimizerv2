"""Config endpoints — providers, models, domains."""
from __future__ import annotations

from fastapi import APIRouter
from services.llm_client import PROVIDER_NAMES, TARGET_MODELS
from core.domain_templates import get_domain_list

router = APIRouter()


@router.get("/providers")
def get_providers():
    return {"providers": list(PROVIDER_NAMES.keys()), "labels": PROVIDER_NAMES}


@router.get("/target-models")
def get_target_models():
    return {"models": list(TARGET_MODELS.keys()), "labels": TARGET_MODELS}


@router.get("/domains")
def get_domains():
    domains = get_domain_list()
    return {"domains": [{"id": d[0], "name": d[1]} for d in domains]}
