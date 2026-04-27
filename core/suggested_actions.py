"""
Heuristic suggested_actions for Agent Studio (no extra LLM).
"""
from __future__ import annotations

from typing import Any

_DEEP_IMPROVE_FEEDBACK = (
    "Ты — редактор промптов. Пользователь уже ответил на уточняющие вопросы — обязательно учти ответы из его сообщения. "
    "Прочитай текст как инструкцию для модели. Сверься с пробелами: роль, формат ответа, контекст, ограничения, примеры. "
    "Кратко отметь в [REASONING], что мешает исполнению, и перепиши промпт целиком в [PROMPT]: чётче, без противоречий и лишней воды. "
    "Не придумывай факты, цифры, имена и детали, которых нет в исходной задаче, текущем промпте и ответах пользователя; "
    "не расширяй тему за рамки задачи. Новый блок [QUESTIONS] не открывай."
)

_CREATIVE_FEEDBACK = (
    "Режим «Креативнее». Пользователь уже ответил на уточняющие вопросы — обязательно учти ответы из его сообщения. "
    "Нужен заметный сдвиг, а не перефраз. "
    "Если итог отличается от исходника только синонимами и прилагательными — считай задачу проваленной; переделай. "
    "ЗАПРЕЩЕНО: накачивать текст штампами («увлекательный», «яркий», «захватывающий», «глубокий», «талантливый» и т.п.) "
    "без новых правил исполнения, нового ракурса или новой структуры для модели. "
    "Ограничения в промпте часто слишком жёсткие и дублируются — АККУРАТНО расслабь рамки: "
    "объедини повторяющиеся запреты в одно ясное правило; убери противоречия «будь креативным» vs «только сухой список»; "
    "добавь короткий подпункт «Где можно смелее» (тон, метафора, тип конфликта, POV, юмор/сатира) согласно ответам пользователя. "
    "Суть задачи, формат (например длительность серии), ключевые цифры из запроса сохрани. "
    "В [PROMPT] внеси содержательное усиление: сетка битов, логлайн-шаблон, голос, критерий сильного поворота и т.д. "
    "Не вноси новые сюжетные факты, противоречащие ответам пользователя. "
    "Формат ответа: [REASONING] кратко [/REASONING] [PROMPT]…[/PROMPT]. Без [QUESTIONS]."
)

# Цели для фазы «вспомогательные вопросы» (тот же текст даёт контекст дешёвому вызову).
IMPROVEMENT_APPLY_GOAL_TEXT: dict[str, str] = {
    "creative": _CREATIVE_FEEDBACK,
    "deep_improve": _DEEP_IMPROVE_FEEDBACK,
}

IMPROVEMENT_PREP_KIND_LABEL_RU: dict[str, str] = {
    "creative": "Креативнее",
    "deep_improve": "Продумать и улучшить",
}

_STRUCTURE_FEEDBACK = (
    "Упорядочи текст: явные блоки (роль, цель, контекст, шаги, формат вывода, ограничения). "
    "Не добавляй новых требований — только ясность и логика."
)

_SHORTEN_FEEDBACK = (
    "Сократи текст промпта, убрав повторы и второстепенное, сохранив роль, цель, ключевые ограничения и формат. "
    "Не выдумывай новых деталей и не меняй смысл."
)


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
                "title": "Короче",
                "emoji": "✂️",
                "action": "iterate",
                "data": {"feedback": _SHORTEN_FEEDBACK},
            }
        )
    if score > 0 and score < 62:
        out.append(
            {
                "id": "structure",
                "title": "Структурнее",
                "emoji": "📐",
                "action": "iterate",
                "data": {"feedback": _STRUCTURE_FEEDBACK},
            }
        )

    out.append(
        {
            "id": "creative",
            "title": "Креативнее",
            "emoji": "✨",
            "action": "iterate",
            "data": {"feedback": _CREATIVE_FEEDBACK},
        }
    )
    out.append(
        {
            "id": "deep_improve",
            "title": "Продумать и улучшить",
            "emoji": "🧭",
            "action": "iterate",
            "data": {"feedback": _DEEP_IMPROVE_FEEDBACK},
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
