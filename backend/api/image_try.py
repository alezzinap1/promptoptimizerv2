"""Пробная генерация картинки через OpenRouter (Nano Banana и др.) для режима изображения."""
from __future__ import annotations

import base64
import logging
import re
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from config.abuse import check_input_size, check_rate_limit
from config.settings import TRIAL_MAX_COMPLETION_PER_M, TRIAL_TOKENS_LIMIT
from backend.deps import get_current_user, get_db, get_session_id
from db.manager import DBManager
from services.api_key_resolver import resolve_openrouter_api_key
from services.openrouter_image import DEFAULT_IMAGE_TRY_MODEL, generate_image_data_url
from services.openrouter_models import completion_price_per_m, get_model_pricing
from io import BytesIO

from PIL import Image

logger = logging.getLogger(__name__)
router = APIRouter()

_ROOT = Path(__file__).resolve().parent.parent.parent
LIB_PREVIEW_DIR = _ROOT / "data" / "uploads" / "library_previews"
LIB_PREVIEW_DIR.mkdir(parents=True, exist_ok=True)


class ImageTryRequest(BaseModel):
    prompt_text: str = Field("", max_length=48_000)
    gen_model: str | None = None
    aspect_ratio: str | None = "1:1"


class ImageTryResponse(BaseModel):
    image_url: str
    gen_model: str
    saved_path: str | None = None


def _data_url_to_bytes(data_url: str) -> bytes:
    m = re.match(r"^data:image/([^;]+);base64,(.+)$", data_url, re.DOTALL)
    if not m:
        raise ValueError("not a data URL")
    return base64.standard_b64decode(m.group(2))


@router.post("/image/try", response_model=ImageTryResponse)
def image_try(
    req: ImageTryRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
    auth_session_id: str | None = Depends(get_session_id),
):
    prompt = (req.prompt_text or "").strip()
    if not prompt:
        raise HTTPException(400, "Пустой prompt_text.")
    ok, err = check_input_size(prompt)
    if not ok:
        raise HTTPException(400, err)
    ok, err = check_rate_limit(auth_session_id or str(user["id"]))
    if not ok:
        raise HTTPException(429, err)

    user_id = int(user["id"])
    user_key = db.get_user_openrouter_api_key(user_id)
    api_key = resolve_openrouter_api_key(user_key)
    if not api_key:
        raise HTTPException(
            500,
            "OpenRouter API key not set. Введите ключ в Настройках или настройте OPENROUTER_API_KEY на сервере.",
        )
    using_host_key = not bool(user_key)
    if using_host_key:
        usage = db.get_user_usage(user_id)
        if usage["tokens_used"] >= TRIAL_TOKENS_LIMIT:
            raise HTTPException(
                402,
                f"Пробный лимит токенов исчерпан. Введите свой API ключ OpenRouter в Настройках.",
            )

    raw_m = (req.gen_model or "").strip()
    if not raw_m:
        mid = DEFAULT_IMAGE_TRY_MODEL
    elif raw_m in PROVIDER_MODELS:
        mid = PROVIDER_MODELS[raw_m]
    elif "/" in raw_m:
        mid = raw_m
    else:
        mid = DEFAULT_IMAGE_TRY_MODEL
    if using_host_key and completion_price_per_m(mid) > TRIAL_MAX_COMPLETION_PER_M:
        raise HTTPException(
            403,
            "Модель недоступна в пробном режиме. Введите свой API ключ или выберите более дешёвую image-модель.",
        )

    started = time.perf_counter()
    try:
        data_url, used_id = generate_image_data_url(
            api_key,
            prompt=prompt,
            model=mid,
            aspect_ratio=req.aspect_ratio or "1:1",
            image_size="1K",
        )
    except Exception as e:
        logger.warning("image_try failed: %s", e, exc_info=True)
        raise HTTPException(502, str(e) or "Ошибка генерации изображения.")

    saved_rel: str | None = None
    try:
        raw = _data_url_to_bytes(data_url)
        uid = uuid.uuid4().hex[:16]
        fname = f"{user_id}_{uid}.webp"
        out_path = LIB_PREVIEW_DIR / fname
        im = Image.open(BytesIO(raw)).convert("RGBA")
        im.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
        buf = BytesIO()
        im.save(buf, format="WEBP", quality=88, method=6)
        out_path.write_bytes(buf.getvalue())
        saved_rel = f"/api/uploads/library_previews/{fname}"
    except Exception as e:
        logger.debug("image_try save preview skipped: %s", e)

    if using_host_key:
        pp, cp = get_model_pricing(used_id)
        est_in = len(prompt) // 4 + 200
        est_out = 800
        db.add_user_usage(user_id, est_in + est_out, est_in * pp + est_out * cp)

    db.log_event(
        "image_try",
        session_id=auth_session_id or "",
        payload={
            "gen_model": used_id,
            "latency_ms": round((time.perf_counter() - started) * 1000, 1),
            "saved": bool(saved_rel),
        },
        user_id=user_id,
    )

    return ImageTryResponse(
        image_url=data_url,
        gen_model=used_id,
        saved_path=saved_rel,
    )
