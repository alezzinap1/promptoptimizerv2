"""
Курируемый каталог моделей 2026 с тирами (fast/mid/advanced), режимами (text/image/skill)
и helper-слоем для промежуточных шагов advanced-режима.

Идея:
- UI показывает пользователю только «Авто / Повседневный / Средний / Продвинутый», а не имена.
- Фактический model_id резолвится `services.model_router` с учётом healthcheck и бюджета.
- Жёсткий потолок: completion ≤ `MAX_COMPLETION_PER_M` ($/1M токенов) для всех Auto-путей.
- Пользователь со своим ключом OpenRouter всё ещё может вручную выбирать любые модели.

Каталог редактируется здесь; `services.model_health` ежедневно проверяет, что id существуют.
"""
from __future__ import annotations

from typing import Literal

Tier = Literal["fast", "mid", "advanced", "helper"]
Mode = Literal["text", "image", "skill"]

MAX_COMPLETION_PER_M: float = 3.0
TRIAL_MAX_COMPLETION_PER_M: float = 1.0

CATALOG: dict[Mode, dict[Tier, list[str]]] = {
    "text": {
        # Trial / fast path: prefer fast, cheap models that feel snappier than DeepSeek for many users.
        "fast": [
            "google/gemini-2.5-flash",
            "mistralai/mistral-nemo",
            "deepseek/deepseek-v4-flash",
        ],
        "mid": [
            "x-ai/grok-3-mini",
            "deepseek/deepseek-v4-flash",
            "google/gemini-2.5-flash",
        ],
        "advanced": [
            "anthropic/claude-haiku-4.5",
            "openai/gpt-4o-mini",
            "deepseek/deepseek-r1",
            "x-ai/grok-3",
        ],
        "helper": [
            "google/gemini-2.5-flash",
            "deepseek/deepseek-v4-flash",
            "mistralai/mistral-nemo",
        ],
    },
    "image": {
        "fast": ["google/gemini-2.5-flash-image"],
        "mid": ["google/gemini-2.5-flash-image"],
        "advanced": ["google/gemini-2.5-flash-image"],
        "helper": ["google/gemini-2.5-flash"],
    },
    "skill": {
        "fast": [
            "google/gemini-2.5-flash",
            "deepseek/deepseek-v4-flash",
        ],
        "mid": [
            "x-ai/grok-3-mini",
            "deepseek/deepseek-v4-flash",
            "google/gemini-2.5-flash",
        ],
        "advanced": [
            "anthropic/claude-haiku-4.5",
            "openai/gpt-4o-mini",
            "deepseek/deepseek-r1",
        ],
        "helper": [
            "google/gemini-2.5-flash",
            "deepseek/deepseek-v4-flash",
        ],
    },
}

TIER_LABELS: dict[Tier, str] = {
    "fast": "Повседневный",
    "mid": "Средний",
    "advanced": "Продвинутый",
    "helper": "Вспомогательный",
}


def all_catalog_model_ids() -> list[str]:
    """Плоский уникальный список всех id, используемых в каталоге (для healthcheck)."""
    seen: set[str] = set()
    out: list[str] = []
    for mode in CATALOG.values():
        for tier_list in mode.values():
            for mid in tier_list:
                if mid and mid not in seen:
                    seen.add(mid)
                    out.append(mid)
    return out


def candidates(mode: Mode, tier: Tier) -> list[str]:
    """Приоритетный список кандидатов для (mode, tier). Пустой → пустой список."""
    return list(CATALOG.get(mode, {}).get(tier, []))
