"""Settings API — get/update app settings (API key, etc.)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.deps import get_current_user, get_db
from db.manager import DBManager
from services.user_preferences import update_user_preferences_payload, get_user_preferences_payload

router = APIRouter()


@router.get("/settings")
def get_settings(
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    """Return current settings (masked). Per-user API key."""
    return get_user_preferences_payload(db, int(user["id"]))


class SettingsUpdate(BaseModel):
    openrouter_api_key: str | None = None
    theme: str | None = None
    font: str | None = None
    color_mode: str | None = None  # dark | light
    preferred_generation_models: list[str] | None = None
    preferred_target_models: list[str] | None = None
    simple_improve_preset: str | None = None
    simple_improve_meta: str | None = None
    task_classification_mode: str | None = None  # heuristic | llm
    task_classifier_model: str | None = None  # OpenRouter id or short key


@router.patch("/settings")
def update_settings(
    req: SettingsUpdate,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    """Update settings. openrouter_api_key is per-user."""
    if req.openrouter_api_key is not None:
        db.set_user_openrouter_api_key(int(user["id"]), req.openrouter_api_key)
    prefs = update_user_preferences_payload(
        db,
        int(user["id"]),
        theme=req.theme,
        font=req.font,
        color_mode=req.color_mode,
        preferred_generation_models=req.preferred_generation_models,
        preferred_target_models=req.preferred_target_models,
        simple_improve_preset=req.simple_improve_preset,
        simple_improve_meta=req.simple_improve_meta,
        task_classification_mode=req.task_classification_mode,
        task_classifier_model=req.task_classifier_model,
    )
    return prefs
