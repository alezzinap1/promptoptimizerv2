"""Community prompt library — public shared prompts with voting and image uploads."""
from __future__ import annotations

import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import BaseModel

from backend.deps import get_current_user, get_db
from db.manager import DBManager

router = APIRouter()

UPLOAD_DIR = Path("data/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_IMAGE_SIZE = 5 * 1024 * 1024  # 5 MB
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


@router.get("/community")
def list_community(
    prompt_type: str | None = None,
    category: str | None = None,
    search: str | None = None,
    sort: str = "newest",
    limit: int = 50,
    offset: int = 0,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    items = db.list_community_prompts(
        prompt_type=prompt_type,
        category=category,
        search=search,
        sort=sort,
        limit=min(limit, 100),
        offset=offset,
        viewer_user_id=int(user["id"]),
    )
    return {"items": items}


@router.get("/community/{prompt_id}")
def get_community_prompt(
    prompt_id: int,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    item = db.get_community_prompt(prompt_id, viewer_user_id=int(user["id"]))
    if not item:
        return {"error": "not_found"}, 404
    return {"item": item}


class CreateCommunityPromptRequest(BaseModel):
    title: str
    prompt: str
    description: str = ""
    prompt_type: str = "text"
    category: str = "general"
    tags: list[str] = []
    image_path: str | None = None


@router.post("/community")
def create_community_prompt(
    req: CreateCommunityPromptRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    id_ = db.create_community_prompt(
        author_user_id=int(user["id"]),
        title=req.title,
        prompt=req.prompt,
        description=req.description,
        prompt_type=req.prompt_type,
        category=req.category,
        tags=req.tags,
        image_path=req.image_path,
    )
    return {"id": id_}


class UpdateCommunityPromptRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    prompt: str | None = None
    tags: list[str] | None = None
    category: str | None = None


@router.patch("/community/{prompt_id}")
def update_community_prompt(
    prompt_id: int,
    req: UpdateCommunityPromptRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    db.update_community_prompt(
        prompt_id,
        user_id=int(user["id"]),
        title=req.title,
        description=req.description,
        prompt=req.prompt,
        tags=req.tags,
        category=req.category,
    )
    return {"ok": True}


@router.delete("/community/{prompt_id}")
def delete_community_prompt(
    prompt_id: int,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    db.delete_community_prompt(prompt_id, user_id=int(user["id"]))
    return {"ok": True}


@router.post("/community/{prompt_id}/vote")
def toggle_vote(
    prompt_id: int,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    voted = db.toggle_community_vote(user_id=int(user["id"]), prompt_id=prompt_id)
    return {"voted": voted}


@router.post("/community/upload-image")
async def upload_image(
    file: UploadFile = File(...),
    _user: dict = Depends(get_current_user),
):
    if not file.filename:
        return {"error": "no_filename"}, 400
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return {"error": "invalid_format", "allowed": list(ALLOWED_EXTENSIONS)}
    data = await file.read()
    if len(data) > MAX_IMAGE_SIZE:
        return {"error": "file_too_large", "max_bytes": MAX_IMAGE_SIZE}
    fname = f"{uuid.uuid4().hex}{ext}"
    dest = UPLOAD_DIR / fname
    dest.write_bytes(data)
    return {"path": f"/api/uploads/{fname}"}
