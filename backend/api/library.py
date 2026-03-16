"""Prompt library CRUD."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.deps import get_current_user, get_db
from db.manager import DBManager

router = APIRouter()


@router.get("/library")
def list_library(
    target_model: str | None = None,
    task_type: str | None = None,
    search: str | None = None,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    items = db.get_library(
        target_model=target_model,
        task_type=task_type,
        search=search,
        user_id=int(user["id"]),
    )
    return {"items": items}


@router.get("/library/stats")
def library_stats(
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    return db.get_library_stats(user_id=int(user["id"]))


class SaveToLibraryRequest(BaseModel):
    title: str
    prompt: str
    tags: list[str] = []
    target_model: str = "unknown"
    task_type: str = "general"
    techniques: list[str] = []
    notes: str = ""


@router.post("/library")
def save_to_library(
    req: SaveToLibraryRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    id_ = db.save_to_library(
        title=req.title,
        prompt=req.prompt,
        tags=req.tags,
        target_model=req.target_model,
        task_type=req.task_type,
        techniques=req.techniques,
        notes=req.notes,
        user_id=int(user["id"]),
    )
    return {"id": id_}


class UpdateLibraryRequest(BaseModel):
    title: str | None = None
    tags: list[str] | None = None
    notes: str | None = None
    rating: int | None = None


@router.patch("/library/{item_id}")
def update_library(
    item_id: int,
    req: UpdateLibraryRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    db.update_library_item(
        item_id,
        title=req.title,
        tags=req.tags,
        notes=req.notes,
        rating=req.rating,
        user_id=int(user["id"]),
    )
    return {"ok": True}


@router.delete("/library/{item_id}")
def delete_from_library(
    item_id: int,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    db.delete_from_library(item_id, user_id=int(user["id"]))
    return {"ok": True}
