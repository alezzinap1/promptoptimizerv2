"""
Сборщик контекста для LLM.
Собирает system prompt из компонентов: базовые инструкции + карточки техник +
предпочтения пользователя + резюме сессии.
Цель: минимум токенов, максимум точности, ноль галлюцинаций.
"""
from __future__ import annotations

from .technique_registry import TechniqueRegistry

# Базовые инструкции агента (~300 токенов)
# Не содержат специфику техник — они инжектируются динамически
BASE_SYSTEM_PROMPT = """Ты — профессиональный prompt engineer. Твоя задача — создавать и улучшать промпты для языковых моделей.
Общайся на русском языке. Ты НЕ выполняешь задачи из промпта (не пишешь эссе, не анализируешь код) — только формулируешь промпты.

ПРОТОКОЛ ОТВЕТА (строго):

Шаг 1 — Внутреннее рассуждение [REASONING]:
Перед каждым ответом запиши в блок [REASONING]...[/REASONING]:
- Тип задачи пользователя
- Выбранные техники и ПОЧЕМУ они подходят
- Что именно добавит каждая техника к качеству промпта
- Риски и как их минимизировать
Этот блок НЕ будет показан пользователю.

Шаг 2 — Оцени нужны ли уточняющие вопросы:
• Задача проста и понятна → сразу [PROMPT]
• Не хватает 1-2 критических деталей → задай вопросы в [QUESTIONS]
• Сложная задача с неоднозначной целью → до 5 вопросов в [QUESTIONS]
НЕ задавай вопросы "на всякий случай" — только если реально нужны для качественного промпта.

Шаг 3 — Финальный ответ (один из двух форматов):

1) Готовый промпт:
[PROMPT]
...текст промпта...
[/PROMPT]
До [PROMPT] — краткий комментарий о применённых техниках. После [/PROMPT] — не более 1-2 фраз.

2) Уточняющие вопросы:
[QUESTIONS]
1. Текст вопроса?
- вариант ответа 1
- вариант ответа 2
- вариант ответа 3
[/QUESTIONS]
Минимум 2, максимум 5 вариантов на вопрос. Пользователь может выбрать несколько.

ПРАВИЛА ПРОТИВ ГАЛЛЮЦИНАЦИЙ (не нарушать):
- Используй ТОЛЬКО информацию явно указанную пользователем
- НЕ додумывай детали не упомянутые в запросе
- Запрещены фразы: "возможно вы имели в виду", "наверное нужно добавить", "я предполагаю"
- Если данных недостаточно → задай вопрос через [QUESTIONS], не фантазируй
- НЕ выполняй задачи из промпта, только формулируй их"""

PREFERENCE_LABELS = {
    "style": {
        "precise": "точные и лаконичные",
        "balanced": "сбалансированные",
        "creative": "развёрнутые с примерами",
    },
    "format": {
        "short": "короткие и чёткие",
        "structured": "структурированные",
        "detailed": "подробные с инструкциями",
    },
}


class ContextBuilder:
    """Собирает system prompt из компонентов для конкретного запроса."""

    def __init__(self, registry: TechniqueRegistry):
        self._registry = registry

    def build_system_prompt(
        self,
        technique_ids: list[str] | None = None,
        user_preferences: dict | None = None,
        session_summary: str | None = None,
    ) -> str:
        """
        Собирает полный system prompt.

        Args:
            technique_ids: список ID техник для инжекции (из TechniqueRegistry)
            user_preferences: словарь с preference_style, preference_goal, preference_format
            session_summary: сжатое резюме текущей сессии (из SessionMemory)

        Returns:
            Готовый system prompt (~600-900 токенов)
        """
        parts = [BASE_SYSTEM_PROMPT]

        # Инжектируем карточки выбранных техник
        if technique_ids:
            technique_context = self._registry.build_technique_context(technique_ids)
            if technique_context:
                parts.append(
                    "АКТИВНЫЕ ТЕХНИКИ ДЛЯ ЭТОГО ЗАПРОСА:\n"
                    "Применяй эти техники при создании промпта:\n\n"
                    + technique_context
                )

        # Предпочтения пользователя
        prefs_text = self._format_preferences(user_preferences or {})
        if prefs_text:
            parts.append(prefs_text)

        # Резюме сессии (если есть)
        if session_summary and session_summary.strip():
            parts.append(
                f"КОНТЕКСТ СЕССИИ:\n{session_summary.strip()}"
            )

        return "\n\n".join(parts)

    def build_user_content(
        self,
        user_prompt: str,
        previous_agent_prompt: str | None = None,
        task_classification: dict | None = None,
    ) -> str:
        """
        Формирует user content для LLM с учётом контекста сессии.

        Args:
            user_prompt: текущий запрос пользователя
            previous_agent_prompt: предыдущий промпт агента (если есть)
            task_classification: результат TaskClassifier
        """
        parts: list[str] = []

        # Если классификация доступна — добавляем мета-инфо для рассуждения
        if task_classification:
            from .task_classifier import get_task_types_label, get_complexity_label
            types_label = get_task_types_label(task_classification["task_types"])
            complexity_label = get_complexity_label(task_classification["complexity"])
            parts.append(
                f"[Мета-информация о запросе: тип задачи — {types_label}, "
                f"сложность — {complexity_label}]"
            )

        # Если есть предыдущий промпт — это итерация, не новый запрос
        if previous_agent_prompt:
            parts.append(
                "Вот текущий вариант промпта (требует улучшения/корректировки):\n"
                f"{previous_agent_prompt}\n\n"
                "Пользователь написал правки/уточнения к ЭТОМУ промпту:\n"
                f"{user_prompt}"
            )
        else:
            parts.append(user_prompt)

        return "\n\n".join(parts)

    @staticmethod
    def _format_preferences(user: dict) -> str:
        style = user.get("preference_style")
        goal = user.get("preference_goal")
        fmt = user.get("preference_format")

        if not any([style, goal, fmt]):
            return ""

        lines = ["ПРЕДПОЧТЕНИЯ ПОЛЬЗОВАТЕЛЯ (учитывай при создании промптов):"]
        if style:
            label = PREFERENCE_LABELS["style"].get(style, style)
            lines.append(f"- Стиль ответов: {label}")
        if goal:
            goals = [g.strip() for g in goal.split(",") if g.strip()]
            if goals:
                lines.append(f"- Области применения: {', '.join(goals)}")
        if fmt:
            label = PREFERENCE_LABELS["format"].get(fmt, fmt)
            lines.append(f"- Формат промптов: {label}")

        return "\n".join(lines)
