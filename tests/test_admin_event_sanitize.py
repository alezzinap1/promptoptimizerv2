from services.admin_event_sanitize import sanitize_event_payload


def test_strips_prompt_like_keys() -> None:
    raw = {"latency_ms": 12, "task_input": "SECRET", "final_prompt": "X"}
    out = sanitize_event_payload("generate_prompt_success", raw)
    assert out["latency_ms"] == 12
    assert "task_input" not in out
    assert "final_prompt" not in out
