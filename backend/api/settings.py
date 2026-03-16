"""Settings API — get/update app settings (API key, etc.)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.deps import get_current_user, get_db
from db.manager import DBManager
from services.settings import get_settings_for_api, get_openrouter_api_key, set_openrouter_api_key
from services.user_preferences import update_user_preferences_payload, get_user_preferences_payload

router = APIRouter()


@router.get("/settings")
def get_settings(
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    """Return current settings (masked)."""
    return {
        **get_settings_for_api(),
        **get_user_preferences_payload(db, int(user["id"])),
    }


class SettingsUpdate(BaseModel):
    openrouter_api_key: str | None = None
    theme: str | None = None
    font: str | None = None
    preferred_generation_models: list[str] | None = None
    preferred_target_models: list[str] | None = None


@router.patch("/settings")
def update_settings(
    req: SettingsUpdate,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    """Update settings. Pass openrouter_api_key to set/clear (empty string to clear)."""
    if req.openrouter_api_key is not None:
        set_openrouter_api_key(req.openrouter_api_key)
    prefs = update_user_preferences_payload(
        db,
        int(user["id"]),
        theme=req.theme,
        font=req.font,
        preferred_generation_models=req.preferred_generation_models,
        preferred_target_models=req.preferred_target_models,
    )
    return {
        **get_settings_for_api(),
        **prefs,
    }
