"""User-defined presets for image / skill studio modes."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.deps import get_current_user, get_db
from db.manager import DBManager

router = APIRouter()


class PresetPayload(BaseModel):
    """image: raw_text (обязательно для кастомного стиля). skill: hint."""

    raw_text: str | None = None
    hint: str | None = None


class PresetCreate(BaseModel):
    kind: Literal["image", "skill"]
    name: str
    description: str = ""
    payload: PresetPayload = Field(default_factory=PresetPayload)


class PresetUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    payload: PresetPayload | None = None


def _payload_to_dict(p: PresetPayload) -> dict:
    d = p.model_dump(exclude_none=True)
    return d


@router.get("/presets")
def list_presets(
    kind: Literal["image", "skill"] | None = Query(default=None),
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    items = db.list_user_presets(user_id=int(user["id"]), kind=kind)
    return {"items": items}


@router.post("/presets")
def create_preset(
    req: PresetCreate,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    if not req.name.strip():
        raise HTTPException(400, "Имя пресета обязательно")
    pl = _payload_to_dict(req.payload)
    if req.kind == "image" and not (pl.get("raw_text") or "").strip():
        raise HTTPException(400, "Для пресета «фото» укажите текст стиля (raw_text)")
    if req.kind == "skill" and not (pl.get("hint") or "").strip():
        raise HTTPException(400, "Для пресета «скилл» укажите подсказку (hint)")
    pid = db.create_user_preset(
        user_id=int(user["id"]),
        kind=req.kind,
        name=req.name,
        description=req.description,
        payload=pl,
    )
    row = db.get_user_preset(pid, int(user["id"]))
    return {"item": row}


@router.patch("/presets/{preset_id}")
def update_preset(
    preset_id: int,
    req: PresetUpdate,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    existing = db.get_user_preset(preset_id, int(user["id"]))
    if not existing:
        raise HTTPException(404, "Пресет не найден")
    pl = None
    if req.payload is not None:
        old = dict(existing.get("payload") or {})
        new = req.payload.model_dump(exclude_none=True)
        pl = {**old, **new}
    db.update_user_preset(
        preset_id,
        int(user["id"]),
        name=req.name,
        description=req.description,
        payload=pl,
    )
    row = db.get_user_preset(preset_id, int(user["id"]))
    return {"item": row}


@router.delete("/presets/{preset_id}")
def delete_preset(
    preset_id: int,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    existing = db.get_user_preset(preset_id, int(user["id"]))
    if not existing:
        raise HTTPException(404, "Пресет не найден")
    db.delete_user_preset(preset_id, int(user["id"]))
    return {"ok": True}
