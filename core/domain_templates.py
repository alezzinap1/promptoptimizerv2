"""
Domain templates for text-focused prompt engineering.
Each domain defines recommended techniques and a checklist for the LLM.
"""
from __future__ import annotations

DOMAINS: dict[str, dict] = {
    "auto": {
        "id": "auto",
        "name": "Авто",
        "description": "Автоматический выбор по задаче",
        "techniques": [],  # empty = use registry selection
        "checklist": "",
    },
    "content": {
        "id": "content",
        "name": "Контент (статьи, посты, реклама)",
        "description": "Создание текстов для блогов, соцсетей, рекламы",
        "techniques": ["role_prompting", "constraints_prompting", "few_shot"],
        "checklist": """
ЧЕКЛИСТ ДЛЯ КОНТЕНТА (уточни если не указано):
- Целевая аудитория (кто читает)
- Тон и стиль (формальный, разговорный, экспертный)
- Длина (слов/символов)
- CTA или цель текста (продажа, информирование, вовлечение)
- Запреты (что не упоминать, каких слов избегать)
""",
    },
    "editing": {
        "id": "editing",
        "name": "Редактура и переписывание",
        "description": "Улучшение, переписывание, смена стиля текста",
        "techniques": ["role_prompting", "structured_output", "constraints_prompting"],
        "checklist": """
ЧЕКЛИСТ ДЛЯ РЕДАКТУРЫ (уточни если не указано):
- Исходный стиль и целевой стиль
- Что сохранить (факты, структура, ключевые формулировки)
- Что изменить (тон, длина, структура предложений)
- Формат вывода (только исправленный текст, diff, комментарии)
""",
    },
    "analysis": {
        "id": "analysis",
        "name": "Анализ и извлечение",
        "description": "Анализ текста, извлечение сущностей, структурирование",
        "techniques": ["role_prompting", "chain_of_thought", "structured_output"],
        "checklist": """
ЧЕКЛИСТ ДЛЯ АНАЛИЗА (уточни если не указано):
- Формат вывода (JSON, таблица, список с полями)
- Какие поля/сущности извлекать
- Обработка отсутствующих данных (null, пропуск, default)
- Язык вывода
""",
    },
    "transformation": {
        "id": "transformation",
        "name": "Трансформация (перевод, суммаризация)",
        "description": "Перевод, суммаризация, перефразирование",
        "techniques": ["role_prompting", "constraints_prompting", "few_shot"],
        "checklist": """
ЧЕКЛИСТ ДЛЯ ТРАНСФОРМАЦИИ (уточни если не указано):
- Исходный и целевой язык (для перевода)
- Длина результата (для суммаризации)
- Сохранять ли тон, термины, имена собственные
- Формат (сплошной текст, bullet points)
""",
    },
    "instruction": {
        "id": "instruction",
        "name": "Инструкции и гайды",
        "description": "Пошаговые инструкции, руководства, процедуры",
        "techniques": ["role_prompting", "least_to_most", "structured_output"],
        "checklist": """
ЧЕКЛИСТ ДЛЯ ИНСТРУКЦИЙ (уточни если не указано):
- Целевая аудитория (новички, эксперты)
- Уровень детализации шагов
- Формат (нумерованный список, чеклист, блоки с подзаголовками)
- Нужны ли предупреждения, советы, примеры
""",
    },
}


def get_domain(domain_id: str) -> dict | None:
    return DOMAINS.get(domain_id)


def get_domain_list() -> list[tuple[str, str]]:
    """Return [(id, name), ...] for UI."""
    return [(d["id"], d["name"]) for d in DOMAINS.values()]


def get_domain_techniques(domain_id: str) -> list[str]:
    """Return technique IDs for domain. Empty = use registry selection."""
    d = DOMAINS.get(domain_id)
    return (d.get("techniques") or []) if d else []


def get_domain_checklist(domain_id: str) -> str:
    d = DOMAINS.get(domain_id)
    return (d.get("checklist") or "").strip() if d else ""
