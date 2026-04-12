"""Одиночный вызов OpenRouter chat/completions с modalities для image (Nano Banana и др.)."""
from __future__ import annotations

import logging
from typing import Any

from openai import OpenAI

from services.llm_client import OPENROUTER_BASE_URL

logger = logging.getLogger(__name__)

# Дефолт: дешёвая image-модель (Nano Banana 2 на OpenRouter). Переопределение: env IMAGE_TRY_MODEL.
DEFAULT_IMAGE_TRY_MODEL = "google/gemini-3.1-flash-image-preview"


def extract_first_image_data_url(completion: Any) -> str | None:
    try:
        choice0 = completion.choices[0]
        msg = choice0.message
        images = getattr(msg, "images", None) or getattr(msg, "parsed", None)
        if hasattr(msg, "model_dump"):
            d = msg.model_dump()
            images = d.get("images") or images
        if not images and isinstance(getattr(msg, "__dict__", None), dict):
            images = msg.__dict__.get("images")
        if not images:
            return None
        first = images[0]
        if isinstance(first, dict):
            iu = first.get("image_url") or first.get("imageUrl")
            if isinstance(iu, dict):
                url = iu.get("url")
                if isinstance(url, str) and url.startswith("data:"):
                    return url
            url2 = first.get("url")
            if isinstance(url2, str) and url2.startswith("data:"):
                return url2
    except (IndexError, AttributeError, KeyError, TypeError) as e:
        logger.debug("extract_first_image_data_url: %s", e)
    return None


def generate_image_data_url(
    api_key: str,
    *,
    prompt: str,
    model: str | None = None,
    aspect_ratio: str | None = "1:1",
    image_size: str | None = "1K",
    timeout: float = 120.0,
) -> tuple[str, str]:
    """
    Возвращает (data_url, model_id).
    Raises RuntimeError если картинки нет в ответе.
    """
    import os

    mid = (model or os.environ.get("IMAGE_TRY_MODEL") or DEFAULT_IMAGE_TRY_MODEL).strip()
    client = OpenAI(api_key=api_key, base_url=OPENROUTER_BASE_URL, timeout=timeout)
    extra: dict[str, Any] = {"modalities": ["image", "text"]}
    if aspect_ratio:
        extra["image_config"] = {
            "aspect_ratio": aspect_ratio,
            "image_size": image_size or "1K",
        }
    kwargs: dict[str, Any] = {
        "model": mid,
        "messages": [{"role": "user", "content": prompt.strip()}],
        "extra_body": extra,
    }
    try:
        completion = client.chat.completions.create(**kwargs)
    except TypeError:
        kwargs.pop("extra_body", None)
        completion = client.chat.completions.create(**kwargs)
    data_url = extract_first_image_data_url(completion)
    if not data_url:
        raise RuntimeError("Модель не вернула изображение (проверьте modalities и id модели на OpenRouter).")
    return data_url, mid
