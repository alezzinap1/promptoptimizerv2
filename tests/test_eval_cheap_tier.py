"""Cheap-tier whitelist for judge and embedding models."""
from __future__ import annotations

import pytest

from services.eval.cheap_tier import (
    CHEAP_EMBEDDING_MODELS,
    CHEAP_JUDGE_MODELS,
    DEFAULT_EMBEDDING_MODEL,
    DEFAULT_JUDGE_MODEL,
    is_cheap_embedding,
    is_cheap_judge,
    require_cheap_judge,
)


def test_default_judge_is_in_whitelist() -> None:
    assert DEFAULT_JUDGE_MODEL in CHEAP_JUDGE_MODELS
    assert is_cheap_judge(DEFAULT_JUDGE_MODEL) is True


def test_default_embedding_is_in_whitelist() -> None:
    assert DEFAULT_EMBEDDING_MODEL in CHEAP_EMBEDDING_MODELS
    assert is_cheap_embedding(DEFAULT_EMBEDDING_MODEL) is True


def test_expensive_judge_rejected() -> None:
    assert is_cheap_judge("openai/gpt-4o") is False
    assert is_cheap_judge("anthropic/claude-3-opus") is False


def test_aliased_judge_resolved() -> None:
    """Deprecated DeepSeek V3 ids are remapped to V4 Flash, which IS in the whitelist."""
    assert is_cheap_judge("deepseek/deepseek-chat") is True


def test_require_cheap_judge_raises_for_premium() -> None:
    with pytest.raises(ValueError, match="cheap"):
        require_cheap_judge("openai/gpt-4o")


def test_require_cheap_judge_returns_resolved_id() -> None:
    assert require_cheap_judge("deepseek/deepseek-chat") == "deepseek/deepseek-v4-flash"
    assert require_cheap_judge(DEFAULT_JUDGE_MODEL) == DEFAULT_JUDGE_MODEL
