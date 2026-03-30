"""
Model taxonomy: classify any model into a behaviour type.

Used to silently adjust technique selection and prompt structure
without exposing complexity to the user.
"""
from __future__ import annotations

import re
from enum import Enum


class ModelType(str, Enum):
    REASONING = "reasoning"
    STANDARD  = "standard"
    SMALL     = "small"


# Patterns that reliably indicate a reasoning / "thinking" model.
_REASONING_PATTERNS: list[str] = [
    r"\bo[134]\b",            # o1, o3, o4
    r"\bo\d+-mini\b",         # o1-mini, o3-mini
    r"\bo\d+-preview\b",      # o1-preview
    r"deepseek[/-]r1\b",      # DeepSeek R1
    r"extended[_-]?thinking",  # Claude Extended Thinking
    r"thinking",               # Gemini Thinking, etc.
    r"\bqwq\b",               # Qwen QwQ (reasoning)
]

_SMALL_PATTERNS: list[str] = [
    r"\b(1b|3b|7b|8b)\b",
    r"\btiny\b",
    r"\bnano\b",
    r"\bsmall\b",
]

_REASONING_IDS: set[str] = {
    "deepseek_r1",
    "o1", "o1-mini", "o1-preview",
    "o3", "o3-mini",
    "o4-mini",
}


def classify_model(model_id: str) -> ModelType:
    """
    Classify a model id (OpenRouter format or short key) into a ModelType.
    Used internally — users never see this label.
    """
    key = (model_id or "").lower().strip()
    if not key or key == "unknown":
        return ModelType.STANDARD

    if key in _REASONING_IDS:
        return ModelType.REASONING

    for pat in _REASONING_PATTERNS:
        if re.search(pat, key):
            return ModelType.REASONING

    for pat in _SMALL_PATTERNS:
        if re.search(pat, key):
            if "gpt" not in key:
                return ModelType.SMALL

    return ModelType.STANDARD


# Techniques that HURT reasoning models (they already think step-by-step).
SUPPRESS_FOR_REASONING: set[str] = {
    "chain_of_thought",
    "self_consistency",
    "tree_of_thoughts",
    "meta_prompting",
}

# Techniques that work well with reasoning models.
PREFER_FOR_REASONING: set[str] = {
    "role_prompting",
    "constraints_prompting",
    "structured_output",
}
