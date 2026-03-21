"""
Resolve OpenRouter API key: user key first, then global settings, then env.
When using host key (no user key): per-user trial budget applies.
"""
from __future__ import annotations

import os

from services.settings import get_openrouter_api_key


def resolve_openrouter_api_key(user_key: str | None = None) -> str:
    """
    Get API key: user_key if set, else global settings, else OPENROUTER_API_KEY env.
    user_key: from db.get_user_openrouter_api_key(user_id)
    """
    if user_key and str(user_key).strip():
        return str(user_key).strip()
    key = get_openrouter_api_key()
    if key:
        return key
    return os.getenv("OPENROUTER_API_KEY", "")
