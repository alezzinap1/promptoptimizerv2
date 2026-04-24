"""Одиночный вызов OpenRouter chat/completions с modalities для image (Nano Banana и др.)."""
from __future__ import annotations

import logging
from typing import Any

from openai import OpenAI

from services.llm_client import OPENROUTER_BASE_URL
from services.openrouter_request_log import maybe_log_openrouter_chat_completion

logger = logging.getLogger(__name__)

# Дефолт: image-модель из каталога OpenRouter. Переопределение: env IMAGE_TRY_MODEL.
# gemini-2.5-flash-image стабильнее маршрутизируется, чем *-preview варианты.
DEFAULT_IMAGE_TRY_MODEL = "google/gemini-2.5-flash-image"


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


def _is_openrouter_modalities_routing_404(exc: BaseException) -> bool:
    """OpenRouter: нет провайдера под запрошенный набор output modalities (часто для image-only моделей)."""
    s = str(exc).lower()
    code = getattr(exc, "status_code", None)
    if code != 404 and "error code: 404" not in s:
        return False
    return "no endpoints found" in s or "modalities" in s or "output modalities" in s


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

    def _extra_body(modalities: list[str]) -> dict[str, Any]:
        body: dict[str, Any] = {"modalities": modalities}
        if aspect_ratio:
            body["image_config"] = {
                "aspect_ratio": aspect_ratio,
                "image_size": image_size or "1K",
            }
        return body

    completion: Any = None
    last_exc: BaseException | None = None
    modality_sets: tuple[list[str], ...] = (["image", "text"], ["image"])
    for mods in modality_sets:
        kwargs: dict[str, Any] = {
            "model": mid,
            "messages": [{"role": "user", "content": prompt.strip()}],
            "extra_body": _extra_body(mods),
        }
        maybe_log_openrouter_chat_completion(log=logger, kwargs=kwargs, context="openrouter_image")
        try:
            completion = client.chat.completions.create(**kwargs)
            last_exc = None
            break
        except TypeError:
            kwargs.pop("extra_body", None)
            maybe_log_openrouter_chat_completion(log=logger, kwargs=kwargs, context="openrouter_image_fallback")
            try:
                completion = client.chat.completions.create(**kwargs)
                last_exc = None
                break
            except BaseException as e:
                last_exc = e
                raise
        except BaseException as e:
            last_exc = e
            if mods == modality_sets[-1] or not _is_openrouter_modalities_routing_404(e):
                raise
            logger.info(
                "openrouter image: model %s rejected modalities %s; retrying with [image] only (%s)",
                mid,
                mods,
                e,
            )
    if completion is None and last_exc is not None:
        raise last_exc
    data_url = extract_first_image_data_url(completion)
    if not data_url:
        raise RuntimeError("Модель не вернула изображение (проверьте modalities и id модели на OpenRouter).")
    return data_url, mid
