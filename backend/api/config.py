"""Config endpoints — domains."""
from __future__ import annotations

from fastapi import APIRouter
from core.domain_templates import get_domain_list

router = APIRouter()


@router.get("/domains")
def get_domains():
    domains = get_domain_list()
    return {"domains": [{"id": d[0], "name": d[1]} for d in domains]}
