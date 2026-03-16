"""
Fetch and cache OpenRouter models list. Cache TTL: 24 hours.
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

logger = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent
CACHE_PATH = ROOT / "data" / "models_cache.json"
OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
CACHE_TTL_SEC = 24 * 60 * 60  # 24 hours


def _fetch_from_openrouter() -> dict:
    """Fetch models from OpenRouter API. No auth required for public list."""
    req = Request(OPENROUTER_MODELS_URL, headers={"User-Agent": "PromptEngineer/1.0"})
    with urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def _normalize_model(m: dict) -> dict:
    """Extract and normalize model fields for dashboard."""
    pricing = m.get("pricing") or {}
    # OpenRouter pricing can be prompt/completion or nested
    prompt_price = None
    completion_price = None
    if isinstance(pricing, dict):
        prompt_price = pricing.get("prompt") or pricing.get("input")
        completion_price = pricing.get("completion") or pricing.get("output")
    if prompt_price is not None and not isinstance(prompt_price, (int, float)):
        try:
            prompt_price = float(prompt_price)
        except (ValueError, TypeError):
            prompt_price = None
    if completion_price is not None and not isinstance(completion_price, (int, float)):
        try:
            completion_price = float(completion_price)
        except (ValueError, TypeError):
            completion_price = None

    return {
        "id": m.get("id", ""),
        "name": m.get("name", m.get("id", "")),
        "description": m.get("description", ""),
        "context_length": m.get("context_length"),
        "pricing": {
            "prompt": prompt_price,
            "completion": completion_price,
        },
        "top_provider": m.get("top_provider", {}),
        "architecture": m.get("architecture"),
    }


def get_models(force_refresh: bool = False) -> dict:
    """
    Get models list. Uses cache if fresh (< 24h), else fetches from OpenRouter.
    Returns: {"data": [...], "updated_at": unix_ts, "from_cache": bool}
    """
    now = time.time()
    if not force_refresh and CACHE_PATH.exists():
        try:
            cached = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
            updated_at = cached.get("updated_at", 0)
            if now - updated_at < CACHE_TTL_SEC:
                return {
                    "data": cached.get("data", []),
                    "updated_at": updated_at,
                    "from_cache": True,
                }
        except (json.JSONDecodeError, OSError) as e:
            logger.warning("Models cache read failed: %s", e)

    try:
        raw = _fetch_from_openrouter()
        raw_data = raw.get("data", [])
        normalized = [_normalize_model(m) for m in raw_data if m.get("id")]
        result = {"data": normalized, "updated_at": now, "from_cache": False}
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        CACHE_PATH.write_text(
            json.dumps({"data": normalized, "updated_at": now}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return result
    except (URLError, HTTPError, json.JSONDecodeError) as e:
        logger.exception("OpenRouter models fetch failed: %s", e)
        # Fallback to stale cache if any
        if CACHE_PATH.exists():
            try:
                cached = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
                return {
                    "data": cached.get("data", []),
                    "updated_at": cached.get("updated_at", 0),
                    "from_cache": True,
                    "stale": True,
                }
            except (json.JSONDecodeError, OSError):
                pass
        return {"data": [], "updated_at": 0, "from_cache": False, "error": str(e)}
