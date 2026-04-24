"""Optional debug logging of payloads sent to OpenRouter (chat.completions)."""
from __future__ import annotations

import json
import logging
from typing import Any

from config.settings import OPENROUTER_LOG_MAX_CHARS, OPENROUTER_LOG_REQUEST_BODIES

logger = logging.getLogger(__name__)


def _json_safe(obj: Any) -> Any:
    if obj is None or isinstance(obj, (bool, int, float, str)):
        return obj
    if isinstance(obj, dict):
        return {str(k): _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_json_safe(x) for x in obj]
    return str(obj)


def maybe_log_openrouter_chat_completion(
    *,
    log: logging.Logger,
    kwargs: dict[str, Any],
    context: str = "",
) -> None:
    """
    When OPENROUTER_LOG_REQUEST_BODIES=1, logs model + messages (+ a few safe kwargs).
    Does not log API keys (they are not in kwargs). Very long JSON is truncated to OPENROUTER_LOG_MAX_CHARS.
    """
    if not OPENROUTER_LOG_REQUEST_BODIES:
        return
    model = kwargs.get("model", "")
    payload: dict[str, Any] = {
        "model": model,
        "messages": _json_safe(kwargs.get("messages")),
    }
    for key in ("temperature", "max_tokens", "top_p", "stream", "response_format", "extra_body"):
        if key in kwargs:
            payload[key] = _json_safe(kwargs[key])
    try:
        text = json.dumps(payload, ensure_ascii=False)
    except (TypeError, ValueError):
        text = repr(payload)
    max_chars = max(4096, int(OPENROUTER_LOG_MAX_CHARS))
    orig_len = len(text)
    if orig_len > max_chars:
        text = text[:max_chars] + f"\n...[openrouter log truncated: {orig_len} chars total, cap={max_chars}]"
    suffix = f" ({context})" if context else ""
    log.info("OpenRouter chat.completions request%s: %s", suffix, text)
