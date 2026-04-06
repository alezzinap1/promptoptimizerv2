"""Tests for context gap scoring and questions policy."""
from core.context_gap import compute_context_gap, get_questions_policy, gap_missing_summary


def test_gap_short_input_high():
    g = compute_context_gap("сделай текст", workspace=None, prompt_type="text")
    assert g >= 0.3


def test_gap_detailed_lower():
    long_task = (
        "Напиши развёрнутый отчёт для аудитории разработчиков в формате markdown. "
        + " ".join([f"Раздел {i}: контекст SaaS и метрики." for i in range(20)])
    )
    g = compute_context_gap(long_task, workspace={"id": 1, "name": "t"}, prompt_type="text")
    assert g < 0.45


def test_policy_skip_vs_required():
    assert get_questions_policy(0.1, "low")["mode"] == "skip"
    assert get_questions_policy(0.9, "high")["max_questions"] == 5


def test_gap_missing_summary_non_empty():
    s = gap_missing_summary("коротко", "text")
    assert len(s) > 5
