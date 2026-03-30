"""
Model-aware token counting.

Uses tiktoken for OpenAI models (exact), approximation for others.
Each model family has a different tokenizer; we pick the closest available.
"""
from __future__ import annotations

import logging
from functools import lru_cache

logger = logging.getLogger(__name__)

try:
    import tiktoken
    _HAS_TIKTOKEN = True
except ImportError:
    _HAS_TIKTOKEN = False
    logger.warning("tiktoken not installed — all token counts will be approximate")


# Model family → tiktoken encoding name.
# o200k_base: GPT-4o family.  cl100k_base: GPT-4/3.5/embeddings.
_ENCODING_FOR_FAMILY: dict[str, str] = {
    "gpt4o":       "o200k_base",
    "gpt4o_mini":  "o200k_base",
    "gpt4":        "cl100k_base",
    "gpt35":       "cl100k_base",
}

# Non-OpenAI models: average chars-per-token ratios (empirically measured).
# These give ±5-10 % accuracy vs the real tokenizer.
_CHARS_PER_TOKEN: dict[str, float] = {
    "claude":    3.4,
    "gemini":    3.8,
    "llama":     3.6,
    "mistral":   3.7,
    "deepseek":  3.5,
    "qwen":      3.3,
    "grok":      3.5,
    "default":   3.5,
}


@lru_cache(maxsize=8)
def _get_encoding(name: str) -> "tiktoken.Encoding | None":
    if not _HAS_TIKTOKEN:
        return None
    try:
        return tiktoken.get_encoding(name)
    except Exception:
        return None


def _resolve_family(model_id: str) -> str:
    """Map an OpenRouter-style model id to a family key."""
    key = (model_id or "").lower()
    if "gpt-4o" in key or "gpt4o" in key:
        if "mini" in key:
            return "gpt4o_mini"
        return "gpt4o"
    if "gpt-4" in key or "gpt4" in key:
        return "gpt4"
    if "gpt-3.5" in key or "gpt35" in key:
        return "gpt35"
    if "claude" in key:
        return "claude"
    if "gemini" in key or "google/" in key:
        return "gemini"
    if "llama" in key or "meta-llama" in key:
        return "llama"
    if "mistral" in key or "mixtral" in key:
        return "mistral"
    if "deepseek" in key:
        return "deepseek"
    if "qwen" in key:
        return "qwen"
    if "grok" in key:
        return "grok"
    return "default"


def count_tokens(text: str, model_id: str = "") -> dict:
    """
    Count tokens for *text* as close as possible to the real tokenizer of *model_id*.

    Returns dict:
        tokens  — int token count
        method  — "tiktoken" | "estimate"
        model   — model_id echo
    """
    if not text:
        return {"tokens": 0, "method": "none", "model": model_id}

    family = _resolve_family(model_id)
    encoding_name = _ENCODING_FOR_FAMILY.get(family)

    if encoding_name and _HAS_TIKTOKEN:
        enc = _get_encoding(encoding_name)
        if enc is not None:
            tokens = len(enc.encode(text))
            return {"tokens": tokens, "method": "tiktoken", "model": model_id}

    cpt = _CHARS_PER_TOKEN.get(family, _CHARS_PER_TOKEN["default"])
    tokens = max(1, round(len(text) / cpt))
    return {"tokens": tokens, "method": "estimate", "model": model_id}


def estimate_tokens_quick(text: str) -> int:
    """Fast approximate count when model is unknown (backward compat)."""
    if not text:
        return 0
    return max(1, round(len(text) / 3.5))
