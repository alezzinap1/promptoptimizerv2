from __future__ import annotations

from config.settings import MAX_INPUT_CHARS
from core.simple_improve import normalize_preset
from db.manager import DBManager
from services.llm_client import PROVIDER_MODELS

DEFAULT_GENERATION_MODELS = [
    PROVIDER_MODELS["deepseek"],
    PROVIDER_MODELS["gpt4o"],
    PROVIDER_MODELS["claude_sonnet"],
    PROVIDER_MODELS["gemini_flash"],
]

# Trial-safe defaults (completion <= $1/1M)
TRIAL_DEFAULT_GENERATION_MODELS = [
    PROVIDER_MODELS["deepseek"],
    PROVIDER_MODELS["gemini_flash"],
    PROVIDER_MODELS["mistral"],
]

DEFAULT_TARGET_MODELS = [
    "unknown",
    PROVIDER_MODELS["gpt4o"],
    PROVIDER_MODELS["claude_sonnet"],
    PROVIDER_MODELS["gemini_flash"],
    PROVIDER_MODELS["mistral"],
]

TRIAL_DEFAULT_TARGET_MODELS = [
    "unknown",
    PROVIDER_MODELS["gemini_flash"],
    PROVIDER_MODELS["mistral"],
]

VALID_PALETTES = frozenset({"amber", "obsidian", "aurora", "dune"})
LEGACY_PALETTE_MAP = {
    "slate": "obsidian",
    "forest": "dune",
    "midnight": "obsidian",
    "ocean": "aurora",
    "mono": "obsidian",
}
VALID_UI_FONTS = frozenset({"plusjakarta", "inter", "dmsans", "geist"})
LEGACY_FONT_MAP = {
    "jetbrains": "plusjakarta",
    "firacode": "plusjakarta",
    "ibmplex": "inter",
    "spacegrotesk": "geist",
    "manrope": "inter",
    "outfit": "geist",
}


def _normalize_palette(raw: str | None) -> str:
    v = str(raw or "amber").strip().lower()
    v = LEGACY_PALETTE_MAP.get(v, v)
    return v if v in VALID_PALETTES else "amber"


def _normalize_ui_font(raw: str | None) -> str:
    v = str(raw or "plusjakarta").strip().lower()
    v = LEGACY_FONT_MAP.get(v, v)
    return v if v in VALID_UI_FONTS else "plusjakarta"


def _normalize_color_mode(raw: str | None) -> str:
    v = str(raw or "dark").strip().lower()
    return v if v in ("dark", "light") else "dark"


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
    user_key = db.get_user_openrouter_api_key(user_id)
    use_trial_defaults = not bool(user_key)
    gen_models = _normalize_models(prefs.get("preferred_generation_models"), allow_unknown=False)
    target_models = _normalize_models(prefs.get("preferred_target_models"), allow_unknown=True)
    if not gen_models:
        gen_models = list(TRIAL_DEFAULT_GENERATION_MODELS if use_trial_defaults else DEFAULT_GENERATION_MODELS)
    if not target_models:
        target_models = list(TRIAL_DEFAULT_TARGET_MODELS if use_trial_defaults else DEFAULT_TARGET_MODELS)
    if "unknown" not in target_models:
        target_models.insert(0, "unknown")
    if use_trial_defaults and gen_models:
        from services.openrouter_models import completion_price_per_m
        from config.settings import TRIAL_MAX_COMPLETION_PER_M
        gen_models = [m for m in gen_models if completion_price_per_m(m) <= TRIAL_MAX_COMPLETION_PER_M]
    if use_trial_defaults and target_models:
        from services.openrouter_models import completion_price_per_m
        from config.settings import TRIAL_MAX_COMPLETION_PER_M
        target_models = ["unknown"] + [m for m in target_models if m != "unknown" and completion_price_per_m(m) <= TRIAL_MAX_COMPLETION_PER_M]
    cls_mode = str(prefs.get("task_classification_mode") or "heuristic").lower()
    if cls_mode not in ("heuristic", "llm"):
        cls_mode = "heuristic"
    return {
        "theme": _normalize_palette(str(prefs.get("theme") or "")),
        "font": _normalize_ui_font(str(prefs.get("font") or "")),
        "color_mode": _normalize_color_mode(str(prefs.get("color_mode") or "")),
        "preferred_generation_models": gen_models,
        "preferred_target_models": target_models,
        "simple_improve_preset": normalize_preset(str(prefs.get("simple_improve_preset"))),
        "simple_improve_meta": str(prefs.get("simple_improve_meta") or "")[:MAX_INPUT_CHARS],
        "task_classification_mode": cls_mode,
        "task_classifier_model": str(prefs.get("task_classifier_model") or "").strip()[:500],
        "image_try_model": str(prefs.get("image_try_model") or "").strip()[:500],
        "openrouter_api_key_set": bool(user_key),
        "openrouter_api_key_masked": (user_key[:7] + "****") if len(user_key) > 7 else ("****" if user_key else ""),
    }


def update_user_preferences_payload(
    db: DBManager,
    user_id: int,
    *,
    theme: str | None = None,
    font: str | None = None,
    color_mode: str | None = None,
    preferred_generation_models: list[str] | None = None,
    preferred_target_models: list[str] | None = None,
    simple_improve_preset: str | None = None,
    simple_improve_meta: str | None = None,
    task_classification_mode: str | None = None,
    task_classifier_model: str | None = None,
    image_try_model: str | None = None,
) -> dict:
    gen_models = None
    if preferred_generation_models is not None:
        gen_models = _normalize_models(preferred_generation_models, allow_unknown=False) or list(DEFAULT_GENERATION_MODELS)
    target_models = None
    if preferred_target_models is not None:
        target_models = _normalize_models(preferred_target_models, allow_unknown=True) or list(DEFAULT_TARGET_MODELS)
        if "unknown" not in target_models:
            target_models.insert(0, "unknown")
    sp = None
    if simple_improve_preset is not None:
        sp = normalize_preset(simple_improve_preset)
    sm = None
    if simple_improve_meta is not None:
        sm = str(simple_improve_meta)[:MAX_INPUT_CHARS]
    tcm = None
    if task_classification_mode is not None:
        v = str(task_classification_mode).strip().lower()
        tcm = v if v in ("heuristic", "llm") else "heuristic"
    tmod = None
    if task_classifier_model is not None:
        tmod = str(task_classifier_model).strip()[:500]
    itm = None
    if image_try_model is not None:
        itm = str(image_try_model).strip()[:500]
    cm = None
    if color_mode is not None:
        cm = _normalize_color_mode(color_mode)
    next_theme = _normalize_palette(theme) if theme is not None else None
    next_font = _normalize_ui_font(font) if font is not None else None
    db.upsert_user_preferences(
        user_id=user_id,
        theme=next_theme if theme is not None else None,
        font=next_font if font is not None else None,
        color_mode=cm,
        preferred_generation_models=gen_models,
        preferred_target_models=target_models,
        simple_improve_preset=sp,
        simple_improve_meta=sm,
        task_classification_mode=tcm,
        task_classifier_model=tmod,
        image_try_model=itm,
    )
    return get_user_preferences_payload(db, user_id)
