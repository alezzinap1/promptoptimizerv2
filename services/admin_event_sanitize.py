"""Strip sensitive keys from app_events payloads for admin read APIs."""
from __future__ import annotations

FORBIDDEN_KEYS = frozenset(
    {
        "task_input",
        "final_prompt",
        "prompt",
        "raw_input",
        "spec_json",
        "completion",
        "messages",
        "text",
        "user_text",
        "llm_raw",
        "feedback",
    }
)


def sanitize_event_payload(event_name: str, payload: object) -> dict:
    if not isinstance(payload, dict):
        return {}
    _ = event_name  # reserved for per-event rules
    return {k: v for k, v in payload.items() if k not in FORBIDDEN_KEYS}
