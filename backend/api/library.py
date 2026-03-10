"""Prompt library CRUD."""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from db.manager import DBManager

router = APIRouter()


def get_db() -> DBManager:
    db = DBManager()
    db.init()
    return db


@router.get("/library")
def list_library(target_model: str | None = None, task_type: str | None = None, search: str | None = None):
    db = get_db()
    items = db.get_library(target_model=target_model, task_type=task_type, search=search)
    return {"items": items}


@router.get("/library/stats")
def library_stats():
    db = get_db()
    return db.get_library_stats()


class SaveToLibraryRequest(BaseModel):
    title: str
    prompt: str
    tags: list[str] = []
    target_model: str = "unknown"
    task_type: str = "general"
    techniques: list[str] = []
    notes: str = ""


@router.post("/library")
def save_to_library(req: SaveToLibraryRequest):
    db = get_db()
    id_ = db.save_to_library(
        title=req.title,
        prompt=req.prompt,
        tags=req.tags,
        target_model=req.target_model,
        task_type=req.task_type,
        techniques=req.techniques,
        notes=req.notes,
    )
    return {"id": id_}


class UpdateLibraryRequest(BaseModel):
    title: str | None = None
    tags: list[str] | None = None
    notes: str | None = None
    rating: int | None = None


@router.patch("/library/{item_id}")
def update_library(item_id: int, req: UpdateLibraryRequest):
    db = get_db()
    db.update_library_item(
        item_id,
        title=req.title,
        tags=req.tags,
        notes=req.notes,
        rating=req.rating,
    )
    return {"ok": True}


@router.delete("/library/{item_id}")
def delete_from_library(item_id: int):
    db = get_db()
    db.delete_from_library(item_id)
    return {"ok": True}
