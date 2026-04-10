"""
Heuristic suggested_actions for Agent Studio (no extra LLM).
"""
from __future__ import annotations

from typing import Any


def build_suggested_actions(
    *,
    has_prompt: bool,
    prompt_type: str,
    current_prompt: str | None,
    metrics: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    if not has_prompt:
        return []
    text = (current_prompt or "").strip()
    m = metrics or {}
    score = float(m.get("completeness_score") or m.get("quality_score") or 0)
    tok = float(m.get("token_estimate") or 0)
    out: list[dict[str, Any]] = []

    if len(text) > 1800 or tok > 900:
        out.append(
            {
                "id": "shorten",
                "title": "Сократить промпт",
                "emoji": "✂️",
                "action": "iterate",
                "data": {
                    "feedback": "Сократи текст промпта примерно на 30–40%, сохранив роль, цель и ключевые ограничения."
                },
            }
        )
    if score > 0 and score < 62:
        out.append(
            {
                "id": "structure",
                "title": "Усилить структуру",
                "emoji": "📐",
                "action": "iterate",
                "data": {
                    "feedback": "Добавь явные секции (цель, контекст, формат ответа, ограничения) и проверь полноту."
                },
            }
        )

    out.append(
        {
            "id": "evaluate",
            "title": "Оценить полноту",
            "emoji": "📊",
            "action": "eval_prompt",
            "data": {},
        }
    )
    out.append(
        {
            "id": "save_library",
            "title": "Сохранить в библиотеку",
            "emoji": "💾",
            "action": "save_library",
            "data": {},
        }
    )

    if prompt_type == "text":
        out.append(
            {
                "id": "compare",
                "title": "Сравнить варианты",
                "emoji": "⚖️",
                "action": "nav_compare",
                "data": {},
            }
        )

    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for item in out:
        iid = str(item.get("id") or "")
        if iid and iid not in seen:
            seen.add(iid)
            unique.append(item)
    return unique[:6]
