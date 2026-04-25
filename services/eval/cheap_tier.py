"""Whitelist of "cheap" judge and embedding models.

Stability evaluation runs a judge (LLM) and an embedding model many times.
We restrict both to a small set of inexpensive models so that a typical
evaluation (N=10..20 outputs + judge + embeddings) stays well under a dollar.

A user explicitly opting into a more expensive judge is rejected with a clear
message — this is a guard rail, not a hard ban: future API versions can add a
`force_premium` flag tied to a higher daily budget.
"""
from __future__ import annotations

from services.llm_client import resolve_openrouter_model_id

# ── Judge: cheap, instruction-following, JSON-stable ──────────────────────
# Order is informational; first item is treated as preferred default.
CHEAP_JUDGE_MODELS: tuple[str, ...] = (
    "openai/gpt-4o-mini",
    "anthropic/claude-3-haiku",
    "google/gemini-2.0-flash-001",
    "deepseek/deepseek-v4-flash",
    "qwen/qwen3-235b-a22b",
)

# ── Embeddings: small, cheap, OpenAI-compatible API ───────────────────────
CHEAP_EMBEDDING_MODELS: tuple[str, ...] = (
    "openai/text-embedding-3-small",
    "openai/text-embedding-3-large",
)

DEFAULT_JUDGE_MODEL: str = CHEAP_JUDGE_MODELS[0]
DEFAULT_EMBEDDING_MODEL: str = CHEAP_EMBEDDING_MODELS[0]


def is_cheap_judge(model_id: str) -> bool:
    """True if `model_id` (after deprecated-alias remap) is in the judge whitelist."""
    resolved = resolve_openrouter_model_id(model_id)
    return resolved in CHEAP_JUDGE_MODELS


def is_cheap_embedding(model_id: str) -> bool:
    """True if `model_id` is in the embedding whitelist."""
    resolved = resolve_openrouter_model_id(model_id)
    return resolved in CHEAP_EMBEDDING_MODELS


def require_cheap_judge(model_id: str) -> str:
    """Validate and return the resolved judge model id, or raise ValueError."""
    resolved = resolve_openrouter_model_id(model_id)
    if resolved not in CHEAP_JUDGE_MODELS:
        raise ValueError(
            f"Judge model {model_id!r} is not in the cheap-tier whitelist. "
            f"Allowed: {', '.join(CHEAP_JUDGE_MODELS)}"
        )
    return resolved


def require_cheap_embedding(model_id: str) -> str:
    """Validate and return the resolved embedding model id, or raise ValueError."""
    resolved = resolve_openrouter_model_id(model_id)
    if resolved not in CHEAP_EMBEDDING_MODELS:
        raise ValueError(
            f"Embedding model {model_id!r} is not in the cheap-tier whitelist. "
            f"Allowed: {', '.join(CHEAP_EMBEDDING_MODELS)}"
        )
    return resolved
