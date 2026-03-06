"""
Context builder — assembles the system prompt from components.
Supports target model awareness, domain templates, and Q&A mode.
"""
from __future__ import annotations

from .domain_templates import get_domain_checklist
from .technique_registry import TechniqueRegistry

BASE_SYSTEM_PROMPT = """Ты — профессиональный prompt engineer. Твоя задача — создавать и улучшать промпты для языковых моделей.
Общайся на русском языке. Ты НЕ выполняешь задачи из промпта (не пишешь эссе, не анализируешь код) — только формулируешь промпты.

ПРОТОКОЛ ОТВЕТА (строго):

Шаг 1 — Внутреннее рассуждение [REASONING]:
Перед каждым ответом запиши в блок [REASONING]...[/REASONING]:
- Тип задачи пользователя
- Выбранные техники и ПОЧЕМУ они подходят
- Что именно добавит каждая техника к качеству промпта
- Особенности целевой модели, которые нужно учесть
Этот блок будет показан пользователю как объяснение.

Шаг 2 — Уточняющие вопросы:
• Задача проста и понятна → сразу [PROMPT]
• Не хватает критических деталей → задай вопросы в [QUESTIONS]
Вопросы должны быть по делу: аудитория, формат, длина, ограничения, примеры.
НЕ задавай вопросы "на всякий случай" — только если реально нужны для качественного промпта.

Шаг 3 — Финальный ответ (один из двух форматов):

1) Готовый промпт:
[PROMPT]
...текст промпта...
[/PROMPT]
До [PROMPT] — 1-2 фразы о применённых техниках.

2) Уточняющие вопросы:
[QUESTIONS]
1. Текст вопроса?
- вариант ответа 1
- вариант ответа 2
- вариант ответа 3
[/QUESTIONS]

ПРАВИЛА ПРОТИВ ГАЛЛЮЦИНАЦИЙ:
- Используй ТОЛЬКО информацию явно указанную пользователем
- НЕ додумывай детали не упомянутые в запросе
- Если данных недостаточно → задай вопрос через [QUESTIONS]
- НЕ выполняй задачи из промпта, только формулируй их"""


TARGET_MODEL_GUIDANCE: dict[str, str] = {
    "claude_3_5": """ЦЕЛЕВАЯ МОДЕЛЬ — Claude 3.5 Sonnet:
- Используй XML-теги для структурирования секций: <task>, <context>, <format>, <instructions>
- Claude хорошо реагирует на явные теги <thinking> для Chain of Thought
- Можно давать очень подробные инструкции — Claude имеет большой контекст и следует им точно
- Используй "Human:" / "Assistant:" паттерн если нужны примеры разговора""",

    "claude_3": """ЦЕЛЕВАЯ МОДЕЛЬ — Claude 3:
- Используй XML-теги для структуры: <task>, <context>, <output_format>
- Явно определяй роль и ограничения в начале промпта""",

    "gpt4o": """ЦЕЛЕВАЯ МОДЕЛЬ — GPT-4o:
- Markdown форматирование хорошо воспринимается моделью
- Chain of Thought эффективен, можно использовать "Let's think step by step"
- Numbered lists для инструкций работают лучше bullet points
- JSON mode доступен — можно явно просить JSON с конкретной схемой""",

    "gpt4o_mini": """ЦЕЛЕВАЯ МОДЕЛЬ — GPT-4o Mini:
- Предпочитай короткие, чёткие инструкции — модель экономична но менее мощная
- Избегай слишком сложных CoT цепочек — снижает качество
- Хорошо работает Few-Shot с 2-3 примерами""",

    "gemini_pro": """ЦЕЛЕВАЯ МОДЕЛЬ — Gemini Pro:
- Используй чёткие разделители между секциями (----, ====)
- Хорошо работает с явно структурированными JSON output запросами
- Gemini хорошо следует инструкциям по формату вывода
- Используй "Note:" секции для важных ограничений""",

    "gemini_flash": """ЦЕЛЕВАЯ МОДЕЛЬ — Gemini Flash:
- Компактные, прямые инструкции работают лучше
- Хорошо понимает bullet-point инструкции
- Для сложных задач добавь явный шаг размышления""",

    "mistral": """ЦЕЛЕВАЯ МОДЕЛЬ — Mistral:
- Чёткие, структурированные инструкции
- Хорошо работает с ролевыми промптами
- Few-Shot примеры особенно эффективны""",

    "llama3": """ЦЕЛЕВАЯ МОДЕЛЬ — Llama 3 (70B):
- Использует chat template — учитывай форматирование <|start_header_id|>
- Хорошо следует инструкциям при чётком их задании
- Избегай слишком длинных промптов — контекстное окно ограничено""",

    "small_model": """ЦЕЛЕВАЯ МОДЕЛЬ — Небольшая модель (< 13B параметров):
- КРИТИЧЕСКИ ВАЖНО: используй простые, прямые инструкции
- ИЗБЕГАЙ Chain of Thought — снижает качество на малых моделях
- Короткие промпты работают лучше длинных
- Few-Shot примеры (2-3) дают лучший результат, чем абстрактные инструкции
- Одна задача за раз — не перегружай несколькими инструкциями""",

    "unknown": "",
}

QUESTIONS_MODE_STRONG = """
РЕЖИМ УТОЧНЯЮЩИХ ВОПРОСОВ (включён):
Обязательно задай 2-5 уточняющих вопросов в [QUESTIONS], если задача недостаточно конкретна.
Вопросы должны быть по делу: целевая аудитория, формат вывода, длина, ограничения, примеры.
Для каждого вопроса дай 2-5 вариантов ответа. Пользователь может выбрать несколько или добавить свой.
Если задача уже полностью ясна — можно сразу [PROMPT], но предпочтительно уточнить хотя бы 1-2 пункта.
"""

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
    def __init__(self, registry: TechniqueRegistry):
        self._registry = registry

    def build_system_prompt(
        self,
        technique_ids: list[str] | None = None,
        user_preferences: dict | None = None,
        session_summary: str | None = None,
        target_model: str = "unknown",
        domain: str = "auto",
        questions_mode: bool = False,
    ) -> str:
        parts = [BASE_SYSTEM_PROMPT]

        # Inject target model guidance
        model_guidance = TARGET_MODEL_GUIDANCE.get(target_model, "")
        if model_guidance:
            parts.append(model_guidance)

        # Inject domain checklist when domain is set
        if domain and domain != "auto":
            checklist = get_domain_checklist(domain)
            if checklist:
                parts.append(("ДОМЕН: " + domain.upper() + "\n" + checklist).strip())

        # Inject questions mode when enabled
        if questions_mode:
            parts.append(QUESTIONS_MODE_STRONG)

        # Inject selected technique cards
        if technique_ids:
            tech_context = self._registry.build_technique_context(technique_ids)
            if tech_context:
                parts.append(
                    "АКТИВНЫЕ ТЕХНИКИ ДЛЯ ЭТОГО ЗАПРОСА:\n"
                    "Применяй эти техники при создании промпта:\n\n"
                    + tech_context
                )

        # User preferences
        prefs_text = self._format_preferences(user_preferences or {})
        if prefs_text:
            parts.append(prefs_text)

        # Session context summary
        if session_summary and session_summary.strip():
            parts.append(f"КОНТЕКСТ СЕССИИ:\n{session_summary.strip()}")

        return "\n\n".join(parts)

    def build_user_content(
        self,
        user_prompt: str,
        previous_agent_prompt: str | None = None,
        task_classification: dict | None = None,
    ) -> str:
        parts: list[str] = []

        if task_classification:
            from .task_classifier import get_task_types_label, get_complexity_label
            types_label = get_task_types_label(task_classification["task_types"])
            complexity_label = get_complexity_label(task_classification["complexity"])
            parts.append(
                f"[Мета-информация: тип задачи — {types_label}, сложность — {complexity_label}]"
            )

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

        lines = ["ПРЕДПОЧТЕНИЯ ПОЛЬЗОВАТЕЛЯ:"]
        if style:
            label = PREFERENCE_LABELS["style"].get(style, style)
            lines.append(f"- Стиль: {label}")
        if goal:
            goals = [g.strip() for g in goal.split(",") if g.strip()]
            if goals:
                lines.append(f"- Области: {', '.join(goals)}")
        if fmt:
            label = PREFERENCE_LABELS["format"].get(fmt, fmt)
            lines.append(f"- Формат: {label}")

        return "\n".join(lines)
