"""
Правила синтаксиса под целевой **движок** генерации изображений (research §1.3 шаг 4, таблица моделей).
Не путать с target_model LLM в OpenRouter — это отдельное поле image_generation_engine.
"""
from __future__ import annotations

# Ключи: auto | midjourney | dalle | sd | flux | leonardo
IMAGE_ENGINE_RULES: dict[str, str] = {
    "auto": (
        "Formatting: use clear sections or comma-separated phrases as appropriate; "
        "include negative/constraints if the target engine supports them; "
        "match the user's language unless they asked for English tags."
    ),
    "midjourney": (
        "Midjourney-style output: prefer weighted concepts with :: where it helps (e.g. concept::2); "
        "use --ar for aspect ratio, --style raw for more photographic realism when suitable; "
        "avoid leading verbs; add --v 6 or --v 6.1 if specifying version; "
        "optional --chaos for variety. Keep [PROMPT] as paste-ready text including parameters on their own lines if needed."
    ),
    "dalle": (
        "DALL-E 3: full sentences often work better than tag soup; describe spatial relationships clearly; "
        "use «in the style of [technique/movement]» rather than living artist names; "
        "this API typically has no separate negative prompt — fold constraints into the main description."
    ),
    "sd": (
        "Stable Diffusion / SDXL: comma-separated tags; include a negative prompt line or section if applicable; "
        "quality boosters like masterpiece, best quality, highly detailed when appropriate; "
        "(concept:1.2) style weights for emphasis."
    ),
    "flux": (
        "Flux: prefers fluent descriptive prose over tag lists; strong on lighting and scene coherence; "
        "less sensitive to hashtag-style tags — prioritize connected description."
    ),
    "leonardo": (
        "Leonardo AI: medium-length prompts work well; artistic references and style words help; "
        "balance detail without extreme length."
    ),
}


def normalize_engine_key(raw: str | None) -> str:
    if not raw:
        return "auto"
    k = str(raw).strip().lower()
    aliases = {
        "mj": "midjourney",
        "midjourney": "midjourney",
        "dall-e": "dalle",
        "dalle": "dalle",
        "dall-e-3": "dalle",
        "sd": "sd",
        "sdxl": "sd",
        "stable-diffusion": "sd",
        "flux": "flux",
        "leonardo": "leonardo",
        "auto": "auto",
        "unknown": "auto",
        "": "auto",
    }
    return aliases.get(k, "auto")


def get_image_engine_syntax_block(engine: str | None) -> str:
    key = normalize_engine_key(engine)
    body = IMAGE_ENGINE_RULES.get(key) or IMAGE_ENGINE_RULES["auto"]
    return f"\n\n--- IMAGE TARGET ENGINE: {key.upper()} ---\n{body}\n--- END ENGINE ---"
