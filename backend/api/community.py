"""Community prompt library — public shared prompts with voting and image uploads."""
from __future__ import annotations

import logging
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from backend.deps import get_current_user, get_db
from backend.image_utils import resize_upload_for_community
from config.abuse import check_input_size
from db.manager import DBManager

logger = logging.getLogger(__name__)

router = APIRouter()

# Тот же каталог, что и StaticFiles в main.py (cwd не влияет)
_ROOT = Path(__file__).resolve().parent.parent.parent
UPLOAD_DIR = _ROOT / "data" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
MAX_IMAGE_SIZE = 12 * 1024 * 1024  # до PIL; после ресайза файл маленький
# Вход: распространённые форматы; выход .webp 512×512 (см. image_utils.COMMUNITY_CARD_SIZE)
ALLOWED_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".jfif",
    ".pjpeg",
    ".png",
    ".webp",
    ".gif",
    ".bmp",
    ".tif",
    ".tiff",
}


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
    combined = f"{req.title}\n{req.description}\n{req.prompt}"
    ok, err = check_input_size(combined)
    if not ok:
        raise HTTPException(400, err)
    try:
        id_ = db.create_community_prompt(
            author_user_id=int(user["id"]),
            title=req.title.strip(),
            prompt=req.prompt,
            description=(req.description or "").strip(),
            prompt_type=req.prompt_type,
            category=req.category,
            tags=req.tags,
            image_path=req.image_path,
        )
    except Exception as e:
        logger.exception("create_community_prompt failed")
        raise HTTPException(500, "Не удалось сохранить публикацию. Повторите попытку.") from e
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
        raise HTTPException(400, "Файл без имени")
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            400,
            f"Формат не поддерживается. Допустимо: jpg, jpeg, png, webp, gif, bmp, tiff…",
        )
    data = await file.read()
    if len(data) > MAX_IMAGE_SIZE:
        raise HTTPException(400, "Файл слишком большой (макс. 12 МБ до обработки)")
    try:
        out, out_ext = resize_upload_for_community(data)
    except Exception as e:
        logger.warning("image decode/resize failed: %s", e)
        raise HTTPException(400, "Не удалось прочитать изображение. Попробуйте другой файл.") from e
    fname = f"{uuid.uuid4().hex}{out_ext}"
    dest = UPLOAD_DIR / fname
    try:
        dest.write_bytes(out)
    except OSError as e:
        logger.exception("community upload write failed")
        raise HTTPException(500, "Не удалось сохранить файл на сервере.") from e
    return {"path": f"/api/uploads/{fname}"}
