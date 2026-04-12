"""Пресеты из manifest.json подхватываются на бэкенде (pixel_art и др.)."""
from core.image_presets import get_image_preset


def test_get_image_preset_pixel_art_from_manifest():
    p = get_image_preset("pixel_art")
    assert p is not None
    assert p.get("id") == "pixel_art"
    assert "pixel" in (p.get("raw_text") or "").lower()


def test_get_image_preset_unknown_returns_none():
    assert get_image_preset("totally_unknown_style_xyz") is None
