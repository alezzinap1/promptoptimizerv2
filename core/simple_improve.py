"""
Meta-improvement of a user prompt (simple mode). Presets + optional user meta-instructions.
"""
from __future__ import annotations

VALID_PRESETS = frozenset(
    {"balanced", "shorter", "stricter", "clearer_structure", "richer_examples"}
)
DEFAULT_PRESET = "balanced"

BASE_SYSTEM = """Ты — редактор промптов для языковых моделей. Улучши текст промпта ниже.

Жёсткие правила:
- **Первый символ ответа — начало улучшенного промпта.** Запрещены преамбулы («Вот…», «Улучшенный промпт:», вступления, пояснения после текста).
- Не добавляй факты, цифры, имена и утверждения, которых нет в исходном промпте.
- Язык результата = язык исходного промпта (смесь → доминирующий).
- Сохрани цель и смысл; можно уточнить формулировки, структуру и ясность."""

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
        "Улучши промпт. Верни **только** финальный текст промпта (один блок, без заголовков и без ```).\n\n"
        "---\n"
        f"{text}\n"
        "---"
    )


def strip_simple_improve_preamble(text: str) -> str:
    """Убирает типичные вступления, если модель нарушила контракт."""
    s = (text or "").strip()
    if not s:
        return s
    # снять обёртку ```...```
    if s.startswith("```"):
        lines = s.split("\n")
        if len(lines) >= 2 and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        s = "\n".join(lines).strip()
    lower = s.lower()
    prefixes = (
        "вот улучшенный",
        "улучшенный промпт",
        "вот переработанный",
        "переработанный промпт",
        "here is the improved",
        "improved prompt",
        "here's the improved",
    )
    for p in prefixes:
        if lower.startswith(p):
            idx = s.find(":")
            if idx != -1 and idx < 120:
                s = s[idx + 1 :].strip()
            else:
                first_nl = s.find("\n")
                if first_nl != -1:
                    s = s[first_nl + 1 :].strip()
            break
    return s.strip()
