"""
Классификатор типа задачи.
Определяет тип и сложность пользовательского запроса без вызова LLM,
используя keyword matching. Быстро и без токенов.
"""
from __future__ import annotations

import re

# Матрица ключевых слов → тип задачи
TASK_KEYWORDS: dict[str, list[str]] = {
    "code": [
        "код", "функцию", "функция", "класс", "метод", "скрипт", "алгоритм",
        "баг", "дебаг", "debug", "рефакторинг", "refactor", "sql", "python",
        "javascript", "typescript", "java", "c++", "golang", "rust", "api",
        "endpoint", "запрос к базе", "ошибка в коде", "code review", "ревью кода",
        "unittest", "тест", "покрытие", "coverage",
    ],
    "analysis": [
        "анализ", "проанализируй", "оцени", "сравни", "сравнение", "найди паттерн",
        "исследуй", "изучи", "выяви", "определи", "оцените", "рассмотри",
        "плюсы и минусы", "pros and cons", "swot", "оценка рисков",
        "что лучше", "какой вариант", "обзор",
    ],
    "creative": [
        "напиши текст", "напиши статью", "сочини", "придумай", "история",
        "статья", "пост", "блог", "креативный", "творческий", "рекламный текст",
        "слоган", "заголовок", "описание продукта", "лендинг", "email рассылка",
    ],
    "writing": [
        "перепиши", "улучши текст", "отредактируй", "корректура", "стиль",
        "тон текста", "сделай профессиональнее", "сделай лаконичнее",
        "резюме документа", "изложение", "пресс-релиз", "деловое письмо",
    ],
    "structured_output": [
        "json", "таблицу", "таблица", "список с полями", "верни в формате",
        "структурированный", "xml", "markdown", "yaml", "csv",
        "формат ответа", "верни только",
    ],
    "transformation": [
        "переведи", "перевод", "translate", "перефразируй", "сократи", "расширь",
        "упрости", "сделай сложнее", "адаптируй", "адаптация для",
        "переформулируй", "резюмируй", "суммаризация",
    ],
    "instruction": [
        "пошаговая инструкция", "по шагам", "алгоритм действий", "процедура",
        "руководство", "how-to", "туториал", "гайд", "мануал",
    ],
    "debugging": [
        "почему не работает", "найди ошибку", "что не так", "исправь баг",
        "traceback", "exception", "error", "не работает", "сломалось",
    ],
    "decision_making": [
        "стоит ли", "выбрать", "принять решение", "нужно ли", "какой выбрать",
        "лучше ли", "есть смысл", "рекомендуй", "посоветуй",
    ],
    "research": [
        "исследование", "найди информацию", "что такое", "объясни", "как работает",
        "расскажи о", "что значит", "определение", "теория",
    ],
}

# Индикаторы сложности
COMPLEXITY_HIGH_SIGNALS: list[str] = [
    "подробно", "детально", "полный анализ", "comprehensive", "всесторонне",
    "с примерами", "развёрнуто", "не менее", "минимум", "архитектура",
    "enterprise", "production", "масштабируемый", "производительность",
    "сравни несколько", "все варианты", "полный список",
]

COMPLEXITY_LOW_SIGNALS: list[str] = [
    "кратко", "коротко", "в двух словах", "быстро", "просто", "simple",
    "одним предложением", "резюме", "главное", "суть",
]


def classify_task(user_input: str) -> dict:
    """
    Классифицирует пользовательский запрос.

    Returns:
        {
            "task_types": list[str],      # найденные типы задачи
            "complexity": str,             # "low" | "medium" | "high"
            "word_count": int,
            "has_code": bool,              # есть ли код в запросе
        }
    """
    lower = user_input.lower()
    word_count = len(user_input.split())

    found_types: list[str] = []
    for task_type, keywords in TASK_KEYWORDS.items():
        if any(kw in lower for kw in keywords):
            found_types.append(task_type)

    if not found_types:
        found_types = ["general"]

    # Специальный кейс: если есть "код" и "анализ" — это code review
    if "code" in found_types and "analysis" in found_types:
        found_types = ["code", "analysis"]

    # Определяем сложность
    has_high = any(sig in lower for sig in COMPLEXITY_HIGH_SIGNALS)
    has_low = any(sig in lower for sig in COMPLEXITY_LOW_SIGNALS)

    if has_high or word_count > 100:
        complexity = "high"
    elif has_low or word_count < 15:
        complexity = "low"
    else:
        complexity = "medium"

    # Ищем блоки кода в запросе
    has_code = bool(re.search(r"```|def |class |import |function |SELECT |INSERT ", user_input))

    return {
        "task_types": found_types,
        "complexity": complexity,
        "word_count": word_count,
        "has_code": has_code,
    }


def get_complexity_label(complexity: str) -> str:
    return {
        "low": "простая",
        "medium": "средняя",
        "high": "сложная",
    }.get(complexity, "средняя")


def get_task_types_label(task_types: list[str]) -> str:
    labels = {
        "code": "код/разработка",
        "analysis": "анализ",
        "creative": "творческий текст",
        "writing": "редактура/письмо",
        "structured_output": "структурированный вывод",
        "transformation": "трансформация текста",
        "instruction": "инструкция",
        "debugging": "отладка",
        "decision_making": "принятие решений",
        "research": "исследование",
        "general": "общая задача",
    }
    return ", ".join(labels.get(t, t) for t in task_types)
