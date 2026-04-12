"""
Shared configuration for the Prompt Optimizer stack: FastAPI backend, core domain logic, and scripts.
"""
from config.settings import (
    APP_ENV,
    BUDGET_GENERATIONS_PER_SESSION,
    DB_PATH,
    LLM_TIMEOUT_SEC,
    LOG_LEVEL,
    MAX_INPUT_CHARS,
    MAX_ITERATION_CYCLES,
    RATE_LIMIT_REQUESTS,
    RATE_LIMIT_WINDOW_SEC,
    ROOT,
    SENTRY_DSN,
)
from config.abuse import check_input_size, check_rate_limit, check_session_budget

__all__ = [
    "APP_ENV",
    "BUDGET_GENERATIONS_PER_SESSION",
    "DB_PATH",
    "LLM_TIMEOUT_SEC",
    "LOG_LEVEL",
    "MAX_INPUT_CHARS",
    "MAX_ITERATION_CYCLES",
    "RATE_LIMIT_REQUESTS",
    "RATE_LIMIT_WINDOW_SEC",
    "ROOT",
    "SENTRY_DSN",
    "check_input_size",
    "check_rate_limit",
    "check_session_budget",
]
