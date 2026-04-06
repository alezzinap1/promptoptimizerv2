"""
Context Gap — эвристическая оценка нехватки контекста до генерации и политика уточняющих вопросов.
См. research: pool + policy + contract enforcement на бэкенде.
"""
from __future__ import annotations

import re
from typing import Any

_AUDIENCE_PAT = re.compile(
    r"(аудитори|для кого|клиент|пользовател|reader|audience|роль читател|целевая)",
    re.I,
)
_FORMAT_PAT = re.compile(
    r"(формат|json|markdown|таблиц|списком|bullet|xml|yaml|csv|output|вывод должен)",
    re.I,
)
_DOMAIN_PAT = re.compile(
    r"(компани|продукт|сайт|приложен|код|api|python|sql|база данных|domain|отрасл)",
    re.I,
)
_CONTRADICTION_PAT = re.compile(
    r"(кратко[^\n]{0,40}подробн|подробн[^\n]{0,40}кратко|коротко[^\n]{0,40}развёрнут|"
    r"briefly.{0,30}in detail|кратко.{0,30}длинн)",
    re.I | re.DOTALL,
)
_VISUAL_ANCHOR_PAT = re.compile(
    r"(стиль|свет|палитр|композиц|камер|фон|персонаж|объект|сцена|midjourney|dall|sdxl|realistic|аниме)",
    re.I,
)


def has_audience_signal(text: str) -> bool:
    return bool(_AUDIENCE_PAT.search(text))


def has_format_signal(text: str) -> bool:
    return bool(_FORMAT_PAT.search(text))


def has_domain_signal(text: str) -> bool:
    return bool(_DOMAIN_PAT.search(text))


def has_contradiction_signals(text: str) -> bool:
    return bool(_CONTRADICTION_PAT.search(text))


def has_visual_anchors(text: str) -> bool:
    return bool(_VISUAL_ANCHOR_PAT.search(text))


def compute_context_gap(
    task_input: str,
    *,
    workspace: dict[str, Any] | None,
    prompt_type: str,
) -> float:
    """0.0 = контекста достаточно, 1.0 = сильный разрыв."""
    text = (task_input or "").strip()
    words = text.split()
    n = len(words)
    score = 0.0

    if n < 10:
        score += 0.45
    elif n < 22:
        score += 0.28
    elif n < 45:
        score += 0.12

    if not has_audience_signal(text):
        score += 0.14
    if not has_format_signal(text):
        score += 0.09
    if not workspace and not has_domain_signal(text):
        score += 0.12
    if has_contradiction_signals(text):
        score += 0.18

    if prompt_type == "image":
        if not has_visual_anchors(text) and n < 35:
            score += 0.28
        elif not has_visual_anchors(text):
            score += 0.14

    if prompt_type == "skill":
        if n < 18:
            score += 0.12

    return min(1.0, score)


def get_questions_policy(gap_score: float, complexity: str) -> dict[str, Any]:
    """
    mode:
      skip — можно сразу [PROMPT]
      optional — 0–2 вопроса, по политике часто дожимаем вторым проходом при высоком gap
      required — вопросы обязательны до промпта (или второй проход)
    """
    if gap_score < 0.22:
        return {"mode": "skip", "max_questions": 0}
    if gap_score < 0.48 and complexity != "high":
        return {"mode": "optional", "max_questions": 2}
    if gap_score < 0.78:
        return {"mode": "required", "max_questions": 3}
    return {"mode": "required", "max_questions": 5}


def gap_missing_summary(task_input: str, prompt_type: str) -> str:
    """Краткий список пробелов для узкого вызова «только вопросы»."""
    lines: list[str] = []
    t = (task_input or "").strip()
    words = t.split()

    if len(words) < 12:
        lines.append("цель и контекст задачи сформулированы очень кратко")
    if not has_audience_signal(t):
        lines.append("аудитория или получатель результата")
    if not has_format_signal(t):
        lines.append("желаемый формат вывода")
    if not has_domain_signal(t):
        lines.append("предметная область или среда применения")
    if prompt_type == "image" and not has_visual_anchors(t):
        lines.append("визуальные якоря: стиль, свет, палитра, композиция")
    if prompt_type == "skill":
        lines.append("целевая среда (Cursor, Claude Code, универсально) и границы скилла")
    if has_contradiction_signals(t):
        lines.append("уточнить противоречивые требования (кратко vs подробно и т.п.)")

    if not lines:
        lines.append("детали, влияющие на качество итогового промпта")

    return "; ".join(lines[:6])

