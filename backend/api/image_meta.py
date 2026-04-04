"""Метаданные для режима изображения: встроенные пресеты стиля, движки для синтаксиса промпта."""
from __future__ import annotations

from fastapi import APIRouter

from core.image_presets import IMAGE_STYLE_PRESETS

router = APIRouter()

# Ключи совпадают с `core.image_target_syntax.normalize_engine_key`
IMAGE_ENGINES_UI = [
    {"id": "auto", "label": "Авто / универсально"},
    {"id": "midjourney", "label": "Midjourney"},
    {"id": "dalle", "label": "DALL·E"},
    {"id": "sd", "label": "Stable Diffusion / SDXL"},
    {"id": "flux", "label": "Flux"},
    {"id": "leonardo", "label": "Leonardo AI"},
]


@router.get("/meta/image-options")
def image_options():
    """Пресеты стиля и целевые движки (для подсказок синтаксиса в system prompt)."""
    presets = [
        {
            "id": p["id"],
            "name": p["name"],
            "description": p.get("description", ""),
            "preview_keywords": p.get("preview_keywords", []),
        }
        for p in IMAGE_STYLE_PRESETS
    ]
    return {"presets": presets, "engines": IMAGE_ENGINES_UI}
