"""Deprecated DeepSeek OpenRouter slugs map to V4 Flash."""
from __future__ import annotations

from services.llm_client import resolve_openrouter_model_id


def test_logical_deepseek_is_v4_flash() -> None:
    assert resolve_openrouter_model_id("deepseek") == "deepseek/deepseek-v4-flash"


def test_deprecated_full_ids_rewritten() -> None:
    assert resolve_openrouter_model_id("deepseek/deepseek-chat") == "deepseek/deepseek-v4-flash"
    assert resolve_openrouter_model_id("deepseek/deepseek-v3") == "deepseek/deepseek-v4-flash"
    assert resolve_openrouter_model_id("deepseek/deepseek-v3-base") == "deepseek/deepseek-v4-flash"


def test_other_openrouter_ids_unchanged() -> None:
    assert resolve_openrouter_model_id("openai/gpt-4o-mini") == "openai/gpt-4o-mini"


def test_empty_defaults_to_default_provider_resolution() -> None:
    assert resolve_openrouter_model_id("") == "deepseek/deepseek-v4-flash"
