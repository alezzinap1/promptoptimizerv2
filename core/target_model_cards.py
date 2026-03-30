"""
Карточки подсказок для целевой модели: маппинг OpenRouter id → семейство → короткий actionable текст.
Не полагаемся на «знания модели» о чужих API — даём явные правила для содержимого [PROMPT].
"""
from __future__ import annotations

import re

from core.model_taxonomy import ModelType, classify_model

# Ключ = семейство; значение = компактная инструкция (только для текста внутри [PROMPT])
TARGET_MODEL_CARDS: dict[str, str] = {
    "reasoning": """**Целевой вывод (Reasoning-модель: o1/o3/R1/QwQ):** эта модель думает самостоятельно — НЕ добавляй chain-of-thought, «думай пошагово» или пошаговые инструкции. Пиши прямые, компактные указания: роль, задача, формат вывода, ограничения. Без примеров рассуждений — модель справится сама. Чем короче и точнее — тем лучше.""",
    "claude_3_5": """**Целевой вывод (Claude 3.5 / Sonnet):** структурируй через XML-секции: <task>, <context>, <format>, <instructions>. Для пошагового разбора внутри промпта — опционально <thinking>. Для диалоговых примеров — префиксы Human:/Assistant:. Claude терпим к длинным чётким инструкциям.""",
    "claude_3": """**Целевой вывод (Claude 3):** XML-скелет <task>, <context>, <output_format>; роль и запреты — в начале текста промпта.""",
    "gpt4o": """**Целевой вывод (GPT-4o):** Markdown-заголовки и нумерованные списки для шагов; при сложной логике — явная фраза step-by-step внутри промпта. Если нужен JSON — задай схему полей в тексте промпта.""",
    "gpt4o_mini": """**Целевой вывод (GPT-4o mini):** короткие прямые инструкции; без длинных цепочек рассуждений; 2–3 few-shot строки лучше абстракций.""",
    "gemini_pro": """**Целевой вывод (Gemini Pro):** разделители секций (--- или ===); для строгого формата — явный запрос JSON с полями; важные запреты — блок Note: в конце секции задачи.""",
    "gemini_flash": """**Целевой вывод (Gemini Flash):** компактные bullet-инструкции; одна главная цель; при сложности — один явный шаг «сначала определи …, затем …».""",
    "mistral": """**Целевой вывод (Mistral / Mixtral):** чёткая роль в первой строке; структурированные буллеты; few-shot (2–3) при необходимости.""",
    "llama3": """**Целевой вывод (Llama 3):** учитывай chat-шаблон модели: явные роли User/Assistant в примерах; инструкции списком; не раздувай системный текст внутри пользовательского промпта.""",
    "small_model": """**Целевой вывод (малые модели <~13B):** одна задача, минимум отвлечений; **без** длинного chain-of-thought в целевом промпте; короткие предложения; 2–3 few-shot если нужен формат.""",
    "general_large": """**Целевой вывод (крупная LLM, семейство не распознано):** Markdown или чёткие секции; нумерованные шаги; явный формат ответа (таблица/JSON/текст) одной фразой в начале или конце инструкции.""",
    "unknown": "",
}

def resolve_target_model_family(model_id: str) -> str:
    """
    OpenRouter id (или legacy-ключ) → семейство для карточки.
    """
    raw = (model_id or "").strip()
    if not raw or raw.lower() == "unknown":
        return "unknown"

    if classify_model(raw) == ModelType.REASONING:
        return "reasoning"

    key = raw.lower()
    if key in TARGET_MODEL_CARDS and key not in ("general_large", "reasoning"):
        return key

    # OpenRouter-style ids
    if "claude" in key:
        if "3.5" in key or "3-5" in key or "sonnet" in key or "claude-3-5" in key:
            return "claude_3_5"
        return "claude_3"
    if "gpt-4" in key or "gpt4" in key or "openai/gpt" in key:
        if "mini" in key:
            return "gpt4o_mini"
        return "gpt4o"
    if "gemini" in key or "google/" in key and "gemini" in key:
        if "flash" in key or "2.0-flash" in key or "2.5-flash" in key:
            return "gemini_flash"
        return "gemini_pro"
    if "llama" in key or "meta-llama" in key:
        if re.search(r"\b(1b|3b|7b|8b|small)\b", key):
            return "small_model"
        return "llama3"
    if "mistral" in key or "mixtral" in key:
        return "mistral"
    if "deepseek" in key or "qwen" in key or "grok" in key or "trinity" in key:
        return "general_large"
    # короткие/дешёвые часто ведут себя как малые
    if re.search(r"\b(1b|3b|7b|8b|tiny|mini)(/|-|$)", key) and "gpt" not in key:
        return "small_model"
    return "general_large"


def get_target_model_guidance_block(model_id: str) -> str:
    """Текст для вставки в system после TARGET_GUIDANCE_SCOPE."""
    family = resolve_target_model_family(model_id)
    card = TARGET_MODEL_CARDS.get(family) or ""
    return card.strip()
