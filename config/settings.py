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
# Auth endpoints (per client IP; in-memory — one process)
AUTH_REGISTER_RATE_LIMIT_REQUESTS = int(os.getenv("AUTH_REGISTER_RATE_LIMIT_REQUESTS", "5"))
AUTH_REGISTER_RATE_WINDOW_SEC = int(os.getenv("AUTH_REGISTER_RATE_WINDOW_SEC", "3600"))
AUTH_LOGIN_RATE_LIMIT_REQUESTS = int(os.getenv("AUTH_LOGIN_RATE_LIMIT_REQUESTS", "25"))
AUTH_LOGIN_RATE_WINDOW_SEC = int(os.getenv("AUTH_LOGIN_RATE_WINDOW_SEC", "60"))
ADMIN_API_RATE_LIMIT_REQUESTS = int(os.getenv("ADMIN_API_RATE_LIMIT_REQUESTS", "120"))
ADMIN_API_RATE_WINDOW_SEC = int(os.getenv("ADMIN_API_RATE_WINDOW_SEC", "60"))
BUDGET_GENERATIONS_PER_SESSION = int(os.getenv("BUDGET_GENERATIONS_PER_SESSION", "50"))
LLM_TIMEOUT_SEC = int(os.getenv("LLM_TIMEOUT_SEC", "120"))
MAX_ITERATION_CYCLES = int(os.getenv("MAX_ITERATION_CYCLES", "10"))

# ── Paths ────────────────────────────────────────────────────
DB_PATH = os.getenv("DB_PATH", str(ROOT / "data" / "web_agent.db"))

# ── Sessions ─────────────────────────────────────────────────
SESSION_TTL_HOURS = int(os.getenv("SESSION_TTL_HOURS", "24"))
SESSION_TTL_SEC = max(3600, SESSION_TTL_HOURS * 3600)  # minimum 1 hour

# ── Trial (host key) ─────────────────────────────────────────
TRIAL_TOKENS_LIMIT = int(os.getenv("TRIAL_TOKENS_LIMIT", "50000"))
TRIAL_MAX_COMPLETION_PER_M = float(os.getenv("TRIAL_MAX_COMPLETION_PER_M", "3.0"))  # $/1M tokens (completion)

# ── GitHub OAuth ─────────────────────────────────────────────
GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID", "")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET", "")
# Frontend URL for post-OAuth redirect (auto-detect from CORS_ORIGINS if not set)
FRONTEND_URL = os.getenv("FRONTEND_URL", "https://metaprompt.online")

# ── Observability ────────────────────────────────────────────
SENTRY_DSN = os.getenv("SENTRY_DSN", "")
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO" if APP_ENV == "prod" else "DEBUG")
# Log full chat.completions payloads (model + messages) before each OpenRouter call — dev only; can be huge.
OPENROUTER_LOG_REQUEST_BODIES = os.getenv("OPENROUTER_LOG_REQUEST_BODIES", "0").strip().lower() in (
    "1",
    "true",
    "yes",
    "on",
)
OPENROUTER_LOG_MAX_CHARS = int(os.getenv("OPENROUTER_LOG_MAX_CHARS", "262144"))

# OpenRouter routing (optional). See https://openrouter.ai/docs/guides/routing/provider-selection
# OPENROUTER_PROVIDER_ORDER=x-ai,deepinfra — try providers in order (slugs from model pages).
# OPENROUTER_PROVIDER_ALLOW_FALLBACKS=0 — set allow_fallbacks false when order is set.
# OPENROUTER_PROVIDER_SORT: default throughput — OpenRouter ranks providers without a static list (set off to omit).
_raw_prov_order = os.getenv("OPENROUTER_PROVIDER_ORDER", "").strip()
OPENROUTER_PROVIDER_ORDER: list[str] = [p.strip() for p in _raw_prov_order.split(",") if p.strip()]
_raw_fb = os.getenv("OPENROUTER_PROVIDER_ALLOW_FALLBACKS", "").strip().lower()
if _raw_fb in ("1", "true", "yes", "on"):
    OPENROUTER_PROVIDER_ALLOW_FALLBACKS: bool | None = True
elif _raw_fb in ("0", "false", "no", "off"):
    OPENROUTER_PROVIDER_ALLOW_FALLBACKS = False
else:
    OPENROUTER_PROVIDER_ALLOW_FALLBACKS = None  # omit — OpenRouter default
_raw_sort_env = os.getenv("OPENROUTER_PROVIDER_SORT")
if _raw_sort_env is None:
    _raw_sort = "throughput"
else:
    _raw_sort = _raw_sort_env.strip().lower()
if _raw_sort in ("off", "none", "disable", "false", "0"):
    OPENROUTER_PROVIDER_SORT: str | None = None
elif _raw_sort in ("throughput", "latency", "price"):
    OPENROUTER_PROVIDER_SORT = _raw_sort
elif _raw_sort == "":
    OPENROUTER_PROVIDER_SORT = "throughput"
else:
    OPENROUTER_PROVIDER_SORT = "throughput"

# ── Семантический роутер агента (fastembed) ─────────────────
# Косинус к центроидам; margin отсекает «почти равные» классы.
SEMANTIC_ROUTE_MIN_CONFIDENCE = float(os.getenv("SEMANTIC_ROUTE_MIN_CONFIDENCE", "0.34"))
SEMANTIC_ROUTE_MIN_MARGIN = float(os.getenv("SEMANTIC_ROUTE_MIN_MARGIN", "0.025"))

# Пре-промпт: два класса (разговор vs задача); пороги чуть мягче, чем у follow-up.
PRE_PROMPT_MIN_CONFIDENCE = float(os.getenv("PRE_PROMPT_MIN_CONFIDENCE", "0.30"))
PRE_PROMPT_MIN_MARGIN = float(os.getenv("PRE_PROMPT_MIN_MARGIN", "0.018"))

# Дешёвый LLM вместо/после embeddings для пре-промпта (гибрид с правилами).
PRE_PROMPT_LLM_ENABLED = os.getenv("PRE_PROMPT_LLM_ENABLED", "1").strip().lower() in (
    "1",
    "true",
    "yes",
    "on",
)
# Ключ из PROVIDER_MODELS в services/llm_client.py (например gemini_flash, grok).
CHEAP_PRE_ROUTER_PROVIDER = os.getenv("CHEAP_PRE_ROUTER_PROVIDER", "gemini_flash").strip()

# Лёгкий ответ в чате студии (диалог до генерации); пусто = тот же провайдер, что у пре-роутера.
AGENT_STUDIO_CHAT_LLM_ENABLED = os.getenv("AGENT_STUDIO_CHAT_LLM_ENABLED", "1").strip().lower() in (
    "1",
    "true",
    "yes",
    "on",
)
AGENT_STUDIO_CHAT_PROVIDER = os.getenv("AGENT_STUDIO_CHAT_PROVIDER", "").strip()
