"""
App settings (API keys, etc.) stored in JSON file.
Used by backend; env vars serve as fallback.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SETTINGS_PATH = ROOT / "data" / "settings.json"


def _load_raw() -> dict:
    """Load raw settings. Returns empty dict if missing/invalid."""
    try:
        if SETTINGS_PATH.exists():
            return json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        pass
    return {}


def _save_raw(data: dict) -> None:
    """Save settings to file."""
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def get_openrouter_api_key() -> str:
    """Get OpenRouter API key from settings. Returns empty string if not set."""
    return _load_raw().get("openrouter_api_key", "")


def set_openrouter_api_key(api_key: str) -> None:
    """Save OpenRouter API key to settings."""
    data = _load_raw()
    data["openrouter_api_key"] = api_key.strip()
    _save_raw(data)


def get_settings_for_api() -> dict:
    """
    Get settings for API response. Masks sensitive values.
    Returns: {"openrouter_api_key_set": bool, "openrouter_api_key_masked": str}
    """
    key = get_openrouter_api_key()
    if not key:
        return {"openrouter_api_key_set": False, "openrouter_api_key_masked": ""}
    # Show first 7 chars + ****
    masked = key[:7] + "****" if len(key) > 7 else "****"
    return {"openrouter_api_key_set": True, "openrouter_api_key_masked": masked}
