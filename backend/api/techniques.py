"""Techniques knowledge base."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.deps import get_current_user, get_db
from db.manager import DBManager
from services.technique_catalog import list_user_techniques_with_defaults

router = APIRouter()


class TechniqueVariant(BaseModel):
    name: str = ""
    pattern: str = ""
    use_when: str = ""


class TechniquePayload(BaseModel):
    id: str
    name: str
    core_pattern: str = ""
    why_it_works: str = ""
    good_example: str = ""
    anti_patterns: list[str] = Field(default_factory=list)
    variants: list[TechniqueVariant] = Field(default_factory=list)
    when_to_use: dict = Field(default_factory=dict)
    compatibility: dict = Field(default_factory=dict)


@router.get("/techniques")
def list_techniques(
    task_type: str | None = None,
    complexity: str | None = None,
    search: str | None = None,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    all_techs = list_user_techniques_with_defaults(db, int(user["id"]))

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


@router.post("/techniques")
def create_technique(
    req: TechniquePayload,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    items = list_user_techniques_with_defaults(db, int(user["id"]))
    if any(str(item.get("id")) == req.id for item in items):
        raise HTTPException(400, "Technique with this ID already exists")
    item = db.create_user_technique(int(user["id"]), req.model_dump())
    return {"item": item}


@router.patch("/techniques/{technique_id}")
def update_technique(
    technique_id: int,
    req: TechniquePayload,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    existing = db.get_user_technique(technique_id, int(user["id"]))
    if not existing:
        raise HTTPException(404, "Technique not found")
    other_items = [item for item in db.list_user_techniques(int(user["id"])) if int(item.get("db_id") or 0) != technique_id]
    if any(str(item.get("id")) == req.id for item in other_items):
        raise HTTPException(400, "Technique with this ID already exists")
    item = db.update_user_technique(technique_id, int(user["id"]), req.model_dump())
    return {"item": item}


@router.delete("/techniques/{technique_id}")
def delete_technique(
    technique_id: int,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    existing = db.get_user_technique(technique_id, int(user["id"]))
    if not existing:
        raise HTTPException(404, "Technique not found")
    db.delete_user_technique(technique_id, int(user["id"]))
    return {"ok": True}
