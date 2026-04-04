"""
Task classifier — determines task type and complexity from user input.
Uses keyword matching (no LLM call) for speed and cost efficiency.
"""
from __future__ import annotations

import re

TASK_KEYWORDS: dict[str, list[str]] = {
    "code": [
        "код", "функцию", "функция", "класс", "метод", "скрипт", "алгоритм",
        "баг", "дебаг", "debug", "рефакторинг", "refactor", "sql", "python",
        "javascript", "typescript", "java", "c++", "golang", "rust", "api",
        "endpoint", "запрос к базе", "ошибка в коде", "code review", "ревью кода",
        "unittest", "тест", "покрытие", "coverage", "dockerfile", "kubernetes",
        "regex", "регулярное выражение",
    ],
    "image_generation": [
        "фото", "картинк", "изображен", "midjourney", "dall-e", "dalle",
        "stable diffusion", "генерация изображен", "image prompt", "промпт для фото",
        "промпт для картин", "промпт для генерации фото", "промпт для генерации картин",
        "нарисуй", "рисунок", "иллюстрац", "визуал", "photo prompt",
    ],
    "analysis": [
        "анализ", "проанализируй", "оцени", "сравни", "сравнение", "найди паттерн",
        "исследуй", "изучи", "выяви", "определи", "рассмотри",
        "плюсы и минусы", "pros and cons", "swot", "оценка рисков",
        "что лучше", "какой вариант", "обзор",
    ],
    "creative": [
        "напиши текст", "напиши статью", "сочини", "придумай", "история",
        "статья", "пост", "блог", "рекламный текст",
        "слоган", "заголовок", "описание продукта", "лендинг",
    ],
    "writing": [
        "перепиши", "улучши текст", "отредактируй", "корректура", "стиль",
        "тон текста", "сделай профессиональнее", "сделай лаконичнее",
        "пресс-релиз", "деловое письмо", "email рассылка",
    ],
    "structured_output": [
        "json", "таблицу", "таблица", "список с полями", "верни в формате",
        "структурированный", "xml", "markdown", "yaml", "csv",
        "формат ответа", "верни только",
    ],
    "transformation": [
        "переведи", "перевод", "translate", "перефразируй", "сократи", "расширь",
        "упрости", "адаптируй", "переформулируй", "резюмируй", "суммаризация",
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
        "стоит ли", "принять решение", "нужно ли",
        "лучше ли", "есть смысл", "рекомендуй", "посоветуй",
    ],
    "research": [
        "исследование", "найди информацию", "что такое", "объясни", "как работает",
        "расскажи о", "что значит", "определение", "теория",
    ],
    "data_analysis": [
        "данные", "датасет", "dataset", "pandas", "numpy", "matplotlib",
        "визуализация данных", "график", "статистика", "корреляция",
        "machine learning", "модель", "обучение модели",
    ],
}

COMPLEXITY_HIGH_SIGNALS: list[str] = [
    "подробно", "детально", "полный анализ", "comprehensive", "всесторонне",
    "с примерами", "развёрнуто", "не менее", "минимум", "архитектура",
    "enterprise", "production", "масштабируемый", "производительность",
    "сравни несколько", "все варианты", "полный список", "многоуровневый",
]

COMPLEXITY_LOW_SIGNALS: list[str] = [
    "кратко", "коротко", "в двух словах", "быстро", "просто", "simple",
    "одним предложением", "резюме", "главное", "суть", "тезисно",
]

TASK_TYPE_LABELS: dict[str, str] = {
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
    "data_analysis": "анализ данных",
    "image_generation": "генерация изображений",
    "general": "общая задача",
}


def detect_prompt_type(user_input: str) -> str:
    """Detect whether the user wants a text prompt, image prompt, or skill."""
    lower = user_input.lower()
    image_signals = [
        "фото", "картинк", "изображен", "midjourney", "dall-e", "dalle",
        "stable diffusion", "image prompt", "промпт для фото", "промпт для картин",
        "нарисуй", "рисунок", "иллюстрац", "photo prompt",
    ]
    skill_signals = [
        "создай скилл", "создай навык", "skill for", "generate skill",
        "навык для", "скилл для", "agent skill", "создай skill",
    ]
    img_hits = sum(1 for s in image_signals if s in lower)
    skill_hits = sum(1 for s in skill_signals if s in lower)
    if img_hits >= 2 or (img_hits == 1 and any(s in lower for s in ["промпт", "prompt", "генерац"])):
        return "image"
    if skill_hits > 0:
        return "skill"
    return "text"


def classify_task(user_input: str) -> dict:
    """
    Classify user input by task type and complexity.

    Returns:
        {
            "task_types": list[str],
            "complexity": "low" | "medium" | "high",
            "word_count": int,
            "has_code": bool,
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

    # Merge redundant combos
    if "code" in found_types and "debugging" in found_types:
        found_types = ["debugging", "code"]
    elif "code" in found_types and "analysis" in found_types:
        found_types = ["code", "analysis"]

    has_high = any(sig in lower for sig in COMPLEXITY_HIGH_SIGNALS)
    has_low = any(sig in lower for sig in COMPLEXITY_LOW_SIGNALS)

    if has_high or word_count > 100:
        complexity = "high"
    elif has_low or word_count < 15:
        complexity = "low"
    else:
        complexity = "medium"

    has_code = bool(re.search(r"```|def |class |import |function |SELECT |INSERT ", user_input))

    return {
        "task_types": found_types,
        "complexity": complexity,
        "word_count": word_count,
        "has_code": has_code,
    }


def heuristic_classification_confidence(classification: dict, user_input: str) -> float:
    """Грубая оценка уверенности эвристики (0–1): general-only ниже, больше совпадений ключей — выше."""
    types = classification.get("task_types") or []
    lower = (user_input or "").lower()
    if types == ["general"]:
        base = 0.42
    else:
        base = 0.58
    hits = 0
    for keywords in TASK_KEYWORDS.values():
        if any(kw in lower for kw in keywords):
            hits += 1
    return min(0.92, base + 0.04 * min(hits, 4))


def get_complexity_label(complexity: str) -> str:
    return {"low": "простая", "medium": "средняя", "high": "сложная"}.get(complexity, "средняя")


def get_task_types_label(task_types: list[str]) -> str:
    return ", ".join(TASK_TYPE_LABELS.get(t, t) for t in task_types)
