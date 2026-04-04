"""
Каталог пресетов стиля для image-режима (research: metaprompt_pipeline_research §1.4).
Используется как «Style inject» в одном проходе генерации — подмешивание в system/user контент.
"""
from __future__ import annotations

from typing import Any

# Ключевые поля совпадают с документом: medium, technique, color_treatment, …
IMAGE_STYLE_PRESETS: list[dict[str, Any]] = [
    {
        "id": "cinematic_noir",
        "name": "Cinematic Noir",
        "description": "Глубокие тени, контрастный свет, атмосфера нуара",
        "preview_keywords": ["high contrast", "dramatic shadows", "film grain"],
        "medium": "35mm film photograph",
        "technique": "chiaroscuro lighting, deep shadows",
        "color_treatment": "desaturated with strong blacks, occasional amber/teal",
        "lighting_treatment": "single source hard light, long shadows",
        "texture": "film grain, slight vignette",
        "era": "1940s-1950s noir aesthetic",
        "quality_append": "cinematic, atmospheric, moody, masterful composition",
        "negative_append": "colorful, bright, cheerful, soft lighting",
    },
    {
        "id": "blockbuster_epic",
        "name": "Blockbuster Epic",
        "description": "Масштаб, драма, киношный свет",
        "preview_keywords": ["epic scale", "dramatic sky", "vista"],
        "medium": "cinematic digital film",
        "technique": "wide establishing shots, volumetric light rays",
        "color_treatment": "rich contrast, teal-orange accents",
        "lighting_treatment": "golden hour or dramatic rim light",
        "texture": "crisp detail, atmospheric haze",
        "era": "modern blockbuster",
        "quality_append": "epic, highly detailed, cinematic composition",
        "negative_append": "flat lighting, amateur snapshot",
    },
    {
        "id": "oil_painting_classic",
        "name": "Oil Painting Classic",
        "description": "Живопись маслом, видимый мазок",
        "preview_keywords": ["brushwork", "canvas texture", "classical"],
        "medium": "traditional oil on canvas",
        "technique": "visible brushstrokes, layered glazing",
        "color_treatment": "warm harmonious palette",
        "lighting_treatment": "soft directional studio light",
        "texture": "impasto highlights, canvas grain",
        "era": "classical European painting",
        "quality_append": "masterful painting, fine art, museum quality",
        "negative_append": "digital sharpness, photographic noise",
    },
    {
        "id": "portrait_studio",
        "name": "Portrait Studio",
        "description": "Студийный портрет, мягкий свет",
        "preview_keywords": ["softbox", "bokeh", "85mm"],
        "medium": "professional studio photograph",
        "technique": "shallow depth of field, portrait lens",
        "color_treatment": "natural skin tones, subtle retouching",
        "lighting_treatment": "soft key + gentle fill",
        "texture": "clean skin detail, smooth background",
        "era": "contemporary portrait photography",
        "quality_append": "sharp eyes, flattering light, professional portrait",
        "negative_append": "harsh shadows, distorted face, extra limbs",
    },
    {
        "id": "golden_hour",
        "name": "Golden Hour",
        "description": "Тёплый закатный свет, длинные тени",
        "preview_keywords": ["sunset", "warm glow", "rim light"],
        "medium": "outdoor natural light photograph",
        "technique": "backlit subjects, lens flare controlled",
        "color_treatment": "warm amber, soft gradients",
        "lighting_treatment": "low sun angle, long soft shadows",
        "texture": "natural atmosphere, subtle haze",
        "era": "timeless outdoor",
        "quality_append": "golden hour glow, atmospheric warmth",
        "negative_append": "cold sterile light, midday harsh sun",
    },
    {
        "id": "hyper_realistic_3d",
        "name": "Hyper-realistic 3D",
        "description": "Реалистичный 3D-рендер",
        "preview_keywords": ["octane", "ray tracing", "PBR"],
        "medium": "photorealistic 3D render",
        "technique": "physically based materials, global illumination",
        "color_treatment": "neutral calibrated tones",
        "lighting_treatment": "HDRI studio or cinematic three-point",
        "texture": "microsurface detail, subsurface scattering on skin",
        "era": "contemporary CGI",
        "quality_append": "8k detail, photorealistic, ray-traced reflections",
        "negative_append": "low poly, flat shading, cartoon",
    },
    {
        "id": "anime_cel",
        "name": "Anime Cel",
        "description": "Аниме, плоские заливки, чистый контур",
        "preview_keywords": ["cel shading", "2D anime", "clean lines"],
        "medium": "digital anime illustration",
        "technique": "bold outlines, flat color regions, anime eyes",
        "color_treatment": "vibrant saturated anime palette",
        "lighting_treatment": "simple cel shading highlights",
        "texture": "clean digital, minimal grain",
        "era": "modern TV anime style",
        "quality_append": "high quality anime art, consistent character design",
        "negative_append": "realistic photo, western cartoon 3D",
    },
    {
        "id": "neon_synthwave",
        "name": "Neon Synthwave",
        "description": "Неон, ретро-футуризм, ночной город",
        "preview_keywords": ["neon", "synthwave", "purple pink cyan"],
        "medium": "digital illustration",
        "technique": "neon rim lights, grid perspective, chrome reflections",
        "color_treatment": "magenta cyan purple gradients on dark",
        "lighting_treatment": "multiple colored light sources, bloom",
        "texture": "subtle scanlines, glow bloom",
        "era": "1980s retrofuturism",
        "quality_append": "vibrant neon, atmospheric cyber mood",
        "negative_append": "daylight, natural earth tones only",
    },
]


def get_image_preset(preset_id: str | None) -> dict[str, Any] | None:
    if not preset_id or not str(preset_id).strip():
        return None
    pid = str(preset_id).strip().lower()
    for p in IMAGE_STYLE_PRESETS:
        if p["id"] == pid:
            return p
    return None


def format_preset_for_prompt(preset: dict[str, Any]) -> str:
    """Текст для подмешивания в запрос (один LLM-вызов вместо отдельного Style Inject)."""
    lines = [
        "[Выбранный пресет стиля — применяй к визуальной подаче; сюжет и объекты пользователя в приоритете.]",
        f"Пресет: {preset.get('name', preset['id'])} — {preset.get('description', '')}",
        f"Medium: {preset.get('medium', '')}",
        f"Technique: {preset.get('technique', '')}",
        f"Color: {preset.get('color_treatment', '')}",
        f"Lighting: {preset.get('lighting_treatment', '')}",
        f"Texture: {preset.get('texture', '')}",
        f"Era / mood: {preset.get('era', '')}",
        f"Усилители качества (умеренно): {preset.get('quality_append', '')}",
        f"Негатив (если уместно для модели): {preset.get('negative_append', '')}",
    ]
    return "\n".join(lines)


def format_active_style_preset_system_block(preset: dict[str, Any]) -> str:
    """Блок для **system** prompt: стиль отделён от пользовательской сцены (роли user vs system)."""
    name = str(preset.get("name") or preset.get("id") or "Preset")
    raw = preset.get("raw_text")
    if raw is not None and str(raw).strip():
        desc = str(preset.get("description") or "").strip()
        header = f"{name}" + (f" — {desc}" if desc else "")
        return (
            f"\n\n--- ACTIVE STYLE PRESET: {header} ---\n"
            "Apply this style to HOW the scene looks, not WHAT is in it (user subject and story have priority).\n"
            f"{str(raw).strip()}\n"
            "--- END ACTIVE STYLE PRESET ---"
        )
    lines = [
        f"\n\n--- ACTIVE STYLE PRESET: {name} ---",
        "Apply these visual parameters in the image prompt. Style changes look and mood, not the user's subject matter.",
        f"- medium: {preset.get('medium', '')}",
        f"- technique: {preset.get('technique', '')}",
        f"- color: {preset.get('color_treatment', '')}",
        f"- lighting: {preset.get('lighting_treatment', '')}",
        f"- texture: {preset.get('texture', '')}",
        f"- era / mood: {preset.get('era', '')}",
        f"- quality boosters: {preset.get('quality_append', '')}",
        f"- negative / avoid: {preset.get('negative_append', '')}",
        "--- END ACTIVE STYLE PRESET ---",
    ]
    return "\n".join(lines)


def format_image_preset_for_generation(preset: dict[str, Any]) -> str:
    """Встроенный пресет или пользовательский с полем raw_text."""
    raw = preset.get("raw_text")
    if raw is not None and str(raw).strip():
        head = (
            "[Пользовательский пресет стиля — применяй к визуальной подаче; "
            "сюжет и объекты пользователя в приоритете.]\n"
        )
        title = str(preset.get("name") or "Пресет").strip()
        desc = str(preset.get("description") or "").strip()
        if desc:
            title = f"{title} — {desc}"
        return head + title + "\n\n" + str(raw).strip()
    return format_preset_for_prompt(preset)
