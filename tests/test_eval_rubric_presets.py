"""Preset rubrics for stability evaluation."""
from __future__ import annotations

from services.eval.rubric_presets import (
    PRESET_RUBRICS,
    get_preset_rubric,
    list_preset_rubrics,
)


def test_default_preset_exists() -> None:
    assert "default_g_eval" in PRESET_RUBRICS
    rubric = get_preset_rubric("default_g_eval")
    assert rubric is not None
    assert rubric["name"]
    assert isinstance(rubric["criteria"], list)
    assert len(rubric["criteria"]) >= 3


def test_each_criterion_has_required_fields() -> None:
    for key, rubric in PRESET_RUBRICS.items():
        for crit in rubric["criteria"]:
            assert "key" in crit, f"{key}: criterion missing key"
            assert "weight" in crit, f"{key}: criterion {crit.get('key')} missing weight"
            assert "description" in crit, f"{key}: criterion {crit.get('key')} missing description"
            assert "anchors" in crit, f"{key}: criterion {crit.get('key')} missing anchors"
            anchors = crit["anchors"]
            assert "0" in anchors and "5" in anchors


def test_unknown_preset_returns_none() -> None:
    assert get_preset_rubric("does-not-exist") is None


def test_list_returns_all_presets() -> None:
    items = list_preset_rubrics()
    assert len(items) == len(PRESET_RUBRICS)
    keys = {it["preset_key"] for it in items}
    assert "default_g_eval" in keys


def test_reference_flag_present() -> None:
    rubric = get_preset_rubric("default_g_eval")
    assert "reference_required" in rubric
    assert isinstance(rubric["reference_required"], bool)
