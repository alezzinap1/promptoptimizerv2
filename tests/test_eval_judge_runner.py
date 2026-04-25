"""Judge runner: parses LLM JSON into structured scores."""
from __future__ import annotations

from unittest.mock import MagicMock

from services.eval.judge_runner import judge_one, judge_pair


_RUBRIC = {
    "name": "tiny",
    "criteria": [
        {"key": "accuracy", "weight": 1.0, "description": "ok", "anchors": {"0": "x", "5": "y"}},
        {"key": "clarity", "weight": 0.5, "description": "ok", "anchors": {"0": "x", "5": "y"}},
    ],
}


def _make_client(generate_json_returns: dict) -> MagicMock:
    c = MagicMock()
    c.generate_json.return_value = generate_json_returns
    return c


def test_judge_one_parses_full_response() -> None:
    client = _make_client(
        {
            "scores": {
                "accuracy": {"score": 4, "reasoning": "good"},
                "clarity": {"score": 3, "reasoning": "okay"},
            },
            "overall": 3.5,
            "reasoning": "balanced",
        }
    )
    out = judge_one(
        client=client,
        judge_model_id="openai/gpt-4o-mini",
        rubric=_RUBRIC,
        prompt_text="P",
        task_input="T",
        output_text="O",
    )
    assert out["overall"] == 3.5
    assert out["reasoning"] == "balanced"
    score_map = {s["criterion_key"]: s["score"] for s in out["scores"]}
    assert score_map == {"accuracy": 4.0, "clarity": 3.0}
    client.generate_json.assert_called_once()
    _, kwargs = client.generate_json.call_args
    assert kwargs["provider"] == "openai/gpt-4o-mini"


def test_judge_one_fills_missing_overall_with_weighted_mean() -> None:
    """If overall is missing or non-numeric, derive from per-criterion scores."""
    client = _make_client(
        {
            "scores": {
                "accuracy": {"score": 5, "reasoning": "x"},
                "clarity": {"score": 3, "reasoning": "y"},
            }
            # no "overall" key
        }
    )
    out = judge_one(
        client=client,
        judge_model_id="m",
        rubric=_RUBRIC,
        prompt_text="P",
        task_input="T",
        output_text="O",
    )
    # weighted: (5*1.0 + 3*0.5) / (1.0+0.5) = 6.5/1.5 = 4.333
    assert abs(out["overall"] - 4.3333) < 0.01


def test_judge_one_handles_garbage_response() -> None:
    """LLM returns nothing parseable — runner must not raise, returns null overall."""
    client = _make_client({})
    out = judge_one(
        client=client,
        judge_model_id="m",
        rubric=_RUBRIC,
        prompt_text="P",
        task_input="T",
        output_text="O",
    )
    assert out["overall"] is None
    assert out["scores"] == []
    assert out["error"] is not None


def test_judge_pair_parses_winner() -> None:
    client = _make_client(
        {"winner": "B", "confidence": 0.7, "reasoning": "B is more accurate"}
    )
    out = judge_pair(
        client=client,
        judge_model_id="m",
        rubric=_RUBRIC,
        prompt_a_text="PA",
        prompt_b_text="PB",
        task_input="T",
        output_a="OA",
        output_b="OB",
    )
    assert out["winner"] == "B"
    assert abs(out["confidence"] - 0.7) < 1e-9
    assert "accurate" in out["reasoning"]


def test_judge_pair_unknown_winner_normalized_to_tie() -> None:
    client = _make_client({"winner": "neither", "confidence": 0.4})
    out = judge_pair(
        client=client,
        judge_model_id="m",
        rubric=_RUBRIC,
        prompt_a_text="PA",
        prompt_b_text="PB",
        task_input="T",
        output_a="OA",
        output_b="OB",
    )
    assert out["winner"] == "tie"


def test_judge_pair_clamps_confidence() -> None:
    client = _make_client({"winner": "A", "confidence": 99})
    out = judge_pair(
        client=client,
        judge_model_id="m",
        rubric=_RUBRIC,
        prompt_a_text="PA",
        prompt_b_text="PB",
        task_input="T",
        output_a="OA",
        output_b="OB",
    )
    assert out["confidence"] == 1.0
