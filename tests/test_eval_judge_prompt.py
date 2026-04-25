"""Builder for judge LLM prompts (single + pair modes)."""
from __future__ import annotations

import json

from services.eval.judge_prompt import (
    build_pair_judge_prompt,
    build_single_judge_prompt,
)
from services.eval.rubric_presets import get_preset_rubric


_RUBRIC = {
    "name": "tiny",
    "criteria": [
        {
            "key": "accuracy",
            "weight": 1.0,
            "description": "Is the answer correct?",
            "anchors": {"0": "wrong", "3": "partial", "5": "perfect"},
        },
        {
            "key": "clarity",
            "weight": 0.5,
            "description": "Is it clear?",
            "anchors": {"0": "incomprehensible", "3": "okay", "5": "crisp"},
        },
    ],
    "reference_required": False,
}


def test_single_judge_includes_rubric_keys_and_anchors() -> None:
    sys_prompt, user_prompt = build_single_judge_prompt(
        rubric=_RUBRIC,
        prompt_text="You are X.",
        task_input="t",
        output_text="answer",
        reference_answer=None,
    )
    assert "accuracy" in sys_prompt
    assert "clarity" in sys_prompt
    assert "wrong" in sys_prompt and "perfect" in sys_prompt
    assert "answer" in user_prompt
    assert "task" not in user_prompt or "t" in user_prompt


def test_single_judge_omits_reference_when_absent() -> None:
    sys_prompt, user_prompt = build_single_judge_prompt(
        rubric=_RUBRIC,
        prompt_text="P",
        task_input="T",
        output_text="O",
        reference_answer=None,
    )
    assert "reference" not in user_prompt.lower()


def test_single_judge_includes_reference_when_provided() -> None:
    _, user_prompt = build_single_judge_prompt(
        rubric=_RUBRIC,
        prompt_text="P",
        task_input="T",
        output_text="O",
        reference_answer="REFERENCE_TEXT",
    )
    assert "REFERENCE_TEXT" in user_prompt


def test_single_judge_requests_json_output_schema() -> None:
    sys_prompt, _ = build_single_judge_prompt(
        rubric=_RUBRIC,
        prompt_text="P",
        task_input="T",
        output_text="O",
    )
    assert "json" in sys_prompt.lower()
    assert "scores" in sys_prompt.lower()
    assert "overall" in sys_prompt.lower()


def test_pair_judge_marks_outputs_as_a_and_b() -> None:
    sys_prompt, user_prompt = build_pair_judge_prompt(
        rubric=_RUBRIC,
        prompt_a_text="PA",
        prompt_b_text="PB",
        task_input="T",
        output_a="OUT_A",
        output_b="OUT_B",
    )
    assert "OUT_A" in user_prompt and "OUT_B" in user_prompt
    assert "winner" in sys_prompt.lower()
    assert '"A"' in sys_prompt or '"B"' in sys_prompt or "winner" in sys_prompt.lower()


def test_pair_judge_includes_reference_when_provided() -> None:
    _, user_prompt = build_pair_judge_prompt(
        rubric=_RUBRIC,
        prompt_a_text="PA",
        prompt_b_text="PB",
        task_input="T",
        output_a="OA",
        output_b="OB",
        reference_answer="REF",
    )
    assert "REF" in user_prompt


def test_default_preset_works_in_builder() -> None:
    """Smoke: a preset rubric must build a valid prompt without errors."""
    rubric = get_preset_rubric("default_g_eval")
    sys_prompt, user_prompt = build_single_judge_prompt(
        rubric=rubric,
        prompt_text="p",
        task_input="t",
        output_text="o",
    )
    # All preset criterion keys appear in system prompt
    for crit in rubric["criteria"]:
        assert crit["key"] in sys_prompt
