"""
Shared settings for dev / demo / prod.
Loads from env: APP_ENV (dev | demo | prod). Default: dev.
"""
from __future__ import annotations

import os
from pathlib import Path

# Environment: dev | demo | prod
APP_ENV = os.getenv("APP_ENV", "dev").lower()
if APP_ENV not in ("dev", "demo", "prod"):
    APP_ENV = "dev"

ROOT = Path(__file__).parent.parent

# ── Limits (abuse protection) ─────────────────────────────────
MAX_INPUT_CHARS = int(os.getenv("MAX_INPUT_CHARS", "50000"))
RATE_LIMIT_REQUESTS = int(os.getenv("RATE_LIMIT_REQUESTS", "30"))
RATE_LIMIT_WINDOW_SEC = int(os.getenv("RATE_LIMIT_WINDOW_SEC", "60"))
BUDGET_GENERATIONS_PER_SESSION = int(os.getenv("BUDGET_GENERATIONS_PER_SESSION", "50"))
LLM_TIMEOUT_SEC = int(os.getenv("LLM_TIMEOUT_SEC", "120"))
MAX_ITERATION_CYCLES = int(os.getenv("MAX_ITERATION_CYCLES", "10"))

# ── Paths ────────────────────────────────────────────────────
DB_PATH = os.getenv("DB_PATH", str(ROOT / "data" / "web_agent.db"))

# ── Observability ────────────────────────────────────────────
SENTRY_DSN = os.getenv("SENTRY_DSN", "")
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO" if APP_ENV == "prod" else "DEBUG")
