from __future__ import annotations

from db.manager import DBManager
from services.llm_client import PROVIDER_MODELS

DEFAULT_GENERATION_MODELS = [
    PROVIDER_MODELS["deepseek"],
    PROVIDER_MODELS["gpt4o"],
    PROVIDER_MODELS["claude_sonnet"],
    PROVIDER_MODELS["gemini_flash"],
]

DEFAULT_TARGET_MODELS = [
    "unknown",
    PROVIDER_MODELS["gpt4o"],
    PROVIDER_MODELS["claude_sonnet"],
    PROVIDER_MODELS["gemini_flash"],
    PROVIDER_MODELS["mistral"],
]


def _normalize_models(values: list[str] | None, *, allow_unknown: bool = False) -> list[str]:
    seen: set[str] = set()
    normalized: list[str] = []
    for raw in values or []:
        value = str(raw or "").strip()
        if not value:
            continue
        if value == "unknown" and not allow_unknown:
            continue
        if value not in seen:
            seen.add(value)
            normalized.append(value)
    return normalized


def get_user_preferences_payload(db: DBManager, user_id: int) -> dict:
    prefs = db.get_user_preferences(user_id)
    gen_models = _normalize_models(prefs.get("preferred_generation_models"), allow_unknown=False)
    target_models = _normalize_models(prefs.get("preferred_target_models"), allow_unknown=True)
    if not gen_models:
        gen_models = list(DEFAULT_GENERATION_MODELS)
    if not target_models:
        target_models = list(DEFAULT_TARGET_MODELS)
    if "unknown" not in target_models:
        target_models.insert(0, "unknown")
    return {
        "theme": str(prefs.get("theme") or "slate"),
        "font": str(prefs.get("font") or "jetbrains"),
        "preferred_generation_models": gen_models,
        "preferred_target_models": target_models,
    }


def update_user_preferences_payload(
    db: DBManager,
    user_id: int,
    *,
    theme: str | None = None,
    font: str | None = None,
    preferred_generation_models: list[str] | None = None,
    preferred_target_models: list[str] | None = None,
) -> dict:
    gen_models = None
    if preferred_generation_models is not None:
        gen_models = _normalize_models(preferred_generation_models, allow_unknown=False) or list(DEFAULT_GENERATION_MODELS)
    target_models = None
    if preferred_target_models is not None:
        target_models = _normalize_models(preferred_target_models, allow_unknown=True) or list(DEFAULT_TARGET_MODELS)
        if "unknown" not in target_models:
            target_models.insert(0, "unknown")
    db.upsert_user_preferences(
        user_id=user_id,
        theme=theme,
        font=font,
        preferred_generation_models=gen_models,
        preferred_target_models=target_models,
    )
    return get_user_preferences_payload(db, user_id)
