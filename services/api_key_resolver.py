"""
Resolve OpenRouter API key: settings first, then env var.
"""
from __future__ import annotations

import os

from services.settings import get_openrouter_api_key


def resolve_openrouter_api_key() -> str:
    """Get API key from settings, fallback to OPENROUTER_API_KEY env."""
    key = get_openrouter_api_key()
    if key:
        return key
    return os.getenv("OPENROUTER_API_KEY", "")
