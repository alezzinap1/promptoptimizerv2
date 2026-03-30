"""
Heuristic quality metrics for prompts.
No LLM calls — pure text analysis.
Provides actionable scores to help users understand prompt quality.
"""
from __future__ import annotations

import re

from core.tokenizer import count_tokens, estimate_tokens_quick


def estimate_tokens(text: str, model_id: str = "") -> int:
    """
    Token count — exact for OpenAI models via tiktoken, approximate for others.
    Falls back to char-based estimation when model is unknown.
    """
    if model_id:
        return count_tokens(text, model_id)["tokens"]
    return estimate_tokens_quick(text)


def count_instructions(text: str) -> int:
    """Count explicit instructions: numbered items and bullet points."""
    count = 0
    for line in text.split("\n"):
        stripped = line.strip()
        if re.match(r"^\d+[\.\)]\s+\S", stripped):
            count += 1
        elif re.match(r"^[-•*]\s+\S", stripped):
            count += 1
    return count


def count_constraints(text: str) -> int:
    """Count explicit constraints and restrictions in the text."""
    constraint_signals = [
        "не ", "нельзя", "запрещено", "запрещен", "избегай", "без ",
        "только ", "исключительно", "никогда", "всегда", "обязательно",
        "don't", "never", "always", "must not", "avoid", "only",
        "without", "no ", "except", "prohibited", "required", "must",
        "не добавляй", "не используй", "не включай", "не делай",
    ]
    lower = text.lower()
    return sum(1 for w in constraint_signals if w in lower)


def has_role(text: str) -> bool:
    """Check if prompt defines an explicit role for the model."""
    patterns = [
        "ты —", "ты -", "you are", "act as", "assume the role",
        "вы —", "вы -", "представь что ты", "imagine you are",
        "your role is", "твоя роль",
    ]
    lower = text.lower()
    return any(p in lower for p in patterns)


def has_output_format(text: str) -> bool:
    """Check if the expected output format is explicitly specified."""
    format_signals = [
        "json", "markdown", "таблиц", "список", "формат", "структур",
        "верни в", "выведи в", "xml", "yaml", "csv", "numbered",
        "bullet", "пронумеруй", "маркированный", "формате ответа",
        "output format", "return as", "respond with", "provide a",
        "в виде", "в формате",
    ]
    lower = text.lower()
    return any(f in lower for f in format_signals)


def has_examples(text: str) -> bool:
    """Check if few-shot examples are included."""
    example_signals = [
        "например:", "пример:", "example:", "e.g.", "input:", "output:",
        "образец", "for example", "как например", "вот пример",
        "ввод:", "вывод:", "input:\n", "output:\n", "# пример",
        "sample:", "sample input", "expected output",
    ]
    lower = text.lower()
    return any(p in lower for p in example_signals)


def has_context(text: str) -> bool:
    """Check if background context is provided."""
    context_signals = [
        "контекст:", "background:", "context:", "дано:", "given:",
        "в контексте", "в рамках", "для проекта", "ситуация:",
        "you are working on", "задача находится", "работаешь с",
    ]
    lower = text.lower()
    return any(p in lower for p in context_signals)


def has_cot_trigger(text: str) -> bool:
    """Check if Chain of Thought is triggered."""
    cot_signals = [
        "шаг за шагом", "step by step", "пошагово", "по шагам",
        "think step", "рассуждай", "сначала", "затем", "наконец",
        "шаг 1", "step 1", "во-первых",
    ]
    lower = text.lower()
    return any(p in lower for p in cot_signals)


def compute_completeness_score(metrics: dict) -> float:
    """
    Compute completeness checklist score (0–100).
    This is NOT a measure of model output quality — only presence of typical prompt elements.

    Rubric:
    - Role defined:       25 pts
    - Output format:      20 pts
    - Instructions:       up to 20 pts (5 per instruction, max 4)
    - Constraints:        up to 15 pts (5 per constraint, max 3)
    - Examples present:   10 pts
    - Context provided:   10 pts
    """
    score = 0.0

    if metrics["has_role"]:
        score += 25

    if metrics["has_output_format"]:
        score += 20

    score += min(20, metrics["instruction_count"] * 5)
    score += min(15, metrics["constraint_count"] * 5)

    if metrics["has_examples"]:
        score += 10

    if metrics["has_context"]:
        score += 10

    return min(100.0, score)


def get_completeness_label(score: float) -> str:
    """Label for completeness checklist score (not quality of model output)."""
    if score >= 80:
        return "Полный"
    if score >= 60:
        return "Хороший"
    if score >= 40:
        return "Средний"
    if score >= 20:
        return "Базовый"
    return "Минимальный"


def get_quality_label(score: float) -> str:
    """Alias for backward compatibility."""
    return get_completeness_label(score)


def get_improvement_tips(metrics: dict) -> list[str]:
    """Return actionable improvement suggestions based on metrics."""
    tips = []

    if not metrics["has_role"]:
        tips.append("Добавь роль: 'Ты — [эксперт]. ...' — повышает качество на 15–25%")

    if not metrics["has_output_format"]:
        tips.append("Укажи формат вывода: JSON, таблица, список с полями, etc.")

    if metrics["instruction_count"] < 2:
        tips.append("Добавь конкретные инструкции (пронумерованный список шагов)")

    if metrics["constraint_count"] == 0:
        tips.append("Добавь ограничения: что модель НЕ должна делать")

    if not metrics["has_examples"]:
        tips.append("Few-Shot: добавь 1–2 примера ввода/вывода для сложных задач")

    if not metrics["has_context"]:
        tips.append("Добавь контекст: для кого/чего создаётся результат")

    if not metrics["has_cot_trigger"] and metrics["token_estimate"] > 100:
        tips.append("Для сложных задач: добавь 'Думай шаг за шагом перед ответом'")

    return tips


def analyze_prompt(text: str, model_id: str = "") -> dict:
    """
    Full prompt analysis. Returns metrics dict with quality score and tips.
    *model_id* (OpenRouter id or short key) enables exact token counting.
    """
    if not text or not text.strip():
        return {
            "token_estimate": 0,
            "token_method": "none",
            "instruction_count": 0,
            "constraint_count": 0,
            "has_role": False,
            "has_output_format": False,
            "has_examples": False,
            "has_context": False,
            "has_cot_trigger": False,
            "completeness_score": 0.0,
            "completeness_label": "Минимальный",
            "improvement_tips": [],
        }

    tok = count_tokens(text, model_id) if model_id else {"tokens": estimate_tokens_quick(text), "method": "estimate"}

    metrics = {
        "token_estimate": tok["tokens"],
        "token_method": tok["method"],
        "instruction_count": count_instructions(text),
        "constraint_count": count_constraints(text),
        "has_role": has_role(text),
        "has_output_format": has_output_format(text),
        "has_examples": has_examples(text),
        "has_context": has_context(text),
        "has_cot_trigger": has_cot_trigger(text),
    }
    metrics["completeness_score"] = compute_completeness_score(metrics)
    metrics["completeness_label"] = get_completeness_label(metrics["completeness_score"])
    metrics["improvement_tips"] = get_improvement_tips(metrics)
    # Backward compatibility
    metrics["quality_score"] = metrics["completeness_score"]
    metrics["quality_label"] = metrics["completeness_label"]

    return metrics
