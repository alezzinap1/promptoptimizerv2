"""
Abuse protection: rate limiting, request size limits, session budget.
Used before LLM generation to prevent abuse and runaway costs.
"""
from __future__ import annotations

import time
from collections import deque
from threading import Lock

from fastapi import Request

from config.settings import (
    AUTH_LOGIN_RATE_LIMIT_REQUESTS,
    AUTH_LOGIN_RATE_WINDOW_SEC,
    AUTH_REGISTER_RATE_LIMIT_REQUESTS,
    AUTH_REGISTER_RATE_WINDOW_SEC,
    BUDGET_GENERATIONS_PER_SESSION,
    MAX_INPUT_CHARS,
    RATE_LIMIT_REQUESTS,
    RATE_LIMIT_WINDOW_SEC,
)


def check_input_size(text: str) -> tuple[bool, str]:
    """Return (ok, error_message). ok=True means within limits."""
    if len(text) > MAX_INPUT_CHARS:
        return False, f"Текст слишком длинный ({len(text)} символов). Лимит: {MAX_INPUT_CHARS}."
    return True, ""


class RateLimiter:
    """In-memory rate limiter per key (e.g. session_id or IP)."""

    def __init__(self, max_requests: int = RATE_LIMIT_REQUESTS, window_sec: float = RATE_LIMIT_WINDOW_SEC):
        self._max = max_requests
        self._window = window_sec
        self._requests: dict[str, deque[float]] = {}
        self._lock = Lock()

    def allow(self, key: str) -> tuple[bool, str]:
        """Return (allowed, error_message). Call before each generation."""
        now = time.monotonic()
        cutoff = now - self._window
        with self._lock:
            if key not in self._requests:
                self._requests[key] = deque()
            q = self._requests[key]
            while q and q[0] < cutoff:
                q.popleft()
            if len(q) >= self._max:
                return False, (
                    f"Слишком много запросов. Подожди {int(self._window)} сек. "
                    f"Лимит: {self._max} запросов в минуту."
                )
            q.append(now)
        return True, ""


_rate_limiter = RateLimiter()

_auth_register_limiter = RateLimiter(
    max_requests=AUTH_REGISTER_RATE_LIMIT_REQUESTS,
    window_sec=float(AUTH_REGISTER_RATE_WINDOW_SEC),
)
_auth_login_limiter = RateLimiter(
    max_requests=AUTH_LOGIN_RATE_LIMIT_REQUESTS,
    window_sec=float(AUTH_LOGIN_RATE_WINDOW_SEC),
)


def client_ip(request: Request) -> str:
    """Client IP for rate limiting. Prefer X-Forwarded-For when behind one proxy."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip() or "unknown"
    if request.client:
        return request.client.host
    return "unknown"


def check_auth_register_rate_limit(request: Request) -> tuple[bool, str]:
    return _auth_register_limiter.allow(f"auth_reg:{client_ip(request)}")


def check_auth_login_rate_limit(request: Request) -> tuple[bool, str]:
    return _auth_login_limiter.allow(f"auth_login:{client_ip(request)}")


def check_rate_limit(session_id: str) -> tuple[bool, str]:
    """Check if session is within rate limit."""
    return _rate_limiter.allow(session_id or "anonymous")


def check_session_budget(generation_count: int, additional: int = 1) -> tuple[bool, str]:
    """
    Check if session has not exceeded generation budget.
    generation_count should be tracked in session_state.
    additional: how many generations this operation will consume (e.g. 2 for Compare A+B).
    """
    if generation_count + additional > BUDGET_GENERATIONS_PER_SESSION:
        return False, (
            f"Лимит генераций в сессии ({BUDGET_GENERATIONS_PER_SESSION}) исчерпан. "
            "Обнови страницу для новой сессии."
        )
    return True, ""
