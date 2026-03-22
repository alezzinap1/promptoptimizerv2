"""
Meta-improvement of a user prompt (simple mode). Presets + optional user meta-instructions.
"""
from __future__ import annotations

VALID_PRESETS = frozenset(
    {"balanced", "shorter", "stricter", "clearer_structure", "richer_examples"}
)
DEFAULT_PRESET = "balanced"

BASE_SYSTEM = """Ты — редактор промптов для языковых моделей. Твоя задача — улучшить текст промпта, который пользователь передаст ниже.

Жёсткие правила:
- Не добавляй факты, цифры, имена и утверждения, которых нет в исходном промпте.
- Не меняй язык ответа: если промпт на русском — результат на русском, если на английском — на английском.
- Сохрани цель и смысл; можно уточнить формулировки, структуру и ясность.
- Не пиши комментарии до или после — только готовый промпт."""

PRESET_SNIPPETS: dict[str, str] = {
    "balanced": "Стиль: сбалансированно улучшить ясность и полноту инструкций без раздувания текста.",
    "shorter": "Стиль: сделать промпт короче, убрать повторы и воду, оставить суть и ограничения.",
    "stricter": "Стиль: добавить явные ограничения и критерии «что нельзя», жёстче формулировать задачу.",
    "clearer_structure": "Стиль: разбить на логичные секции (роль, задача, формат, ограничения) с заголовками или маркированными списками.",
    "richer_examples": "Стиль: если уместно — добавить короткий пример желаемого вывода или few-shot в духе исходного запроса (без выдуманных данных).",
}


def normalize_preset(value: str | None) -> str:
    if not value or str(value).strip() not in VALID_PRESETS:
        return DEFAULT_PRESET
    return str(value).strip()


def build_simple_improve_system_prompt(preset: str, custom_meta: str) -> str:
    preset_key = normalize_preset(preset)
    snippet = PRESET_SNIPPETS.get(preset_key, PRESET_SNIPPETS[DEFAULT_PRESET])
    parts = [BASE_SYSTEM, f"Режим улучшения:\n{snippet}"]
    meta = (custom_meta or "").strip()
    if meta:
        parts.append("Дополнительные указания из настроек пользователя:\n" + meta)
    return "\n\n".join(parts)


def build_simple_improve_user_message(prompt_text: str) -> str:
    text = (prompt_text or "").strip()
    return (
        "Улучши следующий промпт по системным инструкциям.\n\n"
        "Ответь ТОЛЬКО текстом улучшенного промпта, без преамбулы и пояснений.\n\n"
        "---\n"
        f"{text}\n"
        "---"
    )
