"""Settings API — get/update app settings (API key, etc.)."""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from services.settings import get_settings_for_api, get_openrouter_api_key, set_openrouter_api_key

router = APIRouter()


@router.get("/settings")
def get_settings():
    """Return current settings (masked)."""
    return get_settings_for_api()


class SettingsUpdate(BaseModel):
    openrouter_api_key: str | None = None


@router.patch("/settings")
def update_settings(req: SettingsUpdate):
    """Update settings. Pass openrouter_api_key to set/clear (empty string to clear)."""
    if req.openrouter_api_key is not None:
        set_openrouter_api_key(req.openrouter_api_key)
    return get_settings_for_api()
