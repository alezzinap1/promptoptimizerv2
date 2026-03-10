"""Techniques knowledge base."""
from __future__ import annotations

from fastapi import APIRouter
from core.technique_registry import TechniqueRegistry

router = APIRouter()


def get_registry() -> TechniqueRegistry:
    return TechniqueRegistry()


@router.get("/techniques")
def list_techniques(
    task_type: str | None = None,
    complexity: str | None = None,
    search: str | None = None,
):
    registry = get_registry()
    all_techs = registry.get_all()

    if task_type:
        all_techs = [t for t in all_techs if task_type in (t.get("when_to_use") or {}).get("task_types", [])]
    if complexity:
        when = [t.get("when_to_use") or {} for t in all_techs]
        all_techs = [t for t, w in zip(all_techs, when) if not w.get("complexity") or complexity in w.get("complexity", [])]
    if search and search.strip():
        q = search.strip().lower()
        all_techs = [
            t for t in all_techs
            if q in (t.get("name") or "").lower()
            or q in (t.get("id") or "").lower()
            or q in str(t.get("core_pattern", "")).lower()
        ]

    return {"techniques": all_techs}
