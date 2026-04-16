"""Effective trial / session limits (per-user overrides in user_usage)."""
from __future__ import annotations

from config.settings import BUDGET_GENERATIONS_PER_SESSION, TRIAL_TOKENS_LIMIT


def effective_trial_tokens_limit(usage: dict) -> int:
    raw = usage.get("trial_tokens_limit")
    if raw is None:
        return TRIAL_TOKENS_LIMIT
    try:
        v = int(raw)
    except (TypeError, ValueError):
        return TRIAL_TOKENS_LIMIT
    return v if v > 0 else TRIAL_TOKENS_LIMIT


def effective_session_generation_budget(usage: dict) -> int:
    raw = usage.get("session_generation_budget")
    if raw is None:
        return BUDGET_GENERATIONS_PER_SESSION
    try:
        v = int(raw)
    except (TypeError, ValueError):
        return BUDGET_GENERATIONS_PER_SESSION
    return v if v > 0 else BUDGET_GENERATIONS_PER_SESSION
