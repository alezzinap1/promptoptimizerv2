"""
Резолв тира (fast/mid/advanced) в конкретный model_id с учётом healthcheck и режима (text/image/skill).

Главная точка входа: `resolve(db, tier, mode, trial) -> (model_id, reasoning)`.

- tier="auto" → fast для trial, mid в остальных случаях (дешёвый, стабильный дефолт).
- tier="advanced" использует helper-модель для промежуточных шагов (см. `helper_for`).
- Если все кандидаты тира недоступны — deliberate fallback: поднимаемся на fast/helper.
"""
from __future__ import annotations

from typing import Literal

from core.model_catalog import CATALOG, TRIAL_MAX_COMPLETION_PER_M, candidates
from db.manager import DBManager
from services.model_health import is_available, pick_first_available

Tier = Literal["auto", "fast", "mid", "advanced"]
Mode = Literal["text", "image", "skill"]


def _fallback_order(tier: Tier, trial: bool) -> list[str]:
    if trial:
        return ["fast", "mid"]  # никогда не advanced в trial
    if tier == "auto":
        return ["mid", "fast", "advanced"]
    if tier == "fast":
        return ["fast", "mid"]
    if tier == "mid":
        return ["mid", "fast", "advanced"]
    return ["advanced", "mid", "fast"]


def _pricing_per_m(db: DBManager, model_id: str) -> float:
    row = next((r for r in db.list_model_health() if r["model_id"] == model_id), None)
    if not row:
        return 0.0
    cp = row.get("last_pricing_completion")
    try:
        return float(cp) * 1_000_000.0 if cp else 0.0
    except (TypeError, ValueError):
        return 0.0


def resolve(
    db: DBManager,
    tier: Tier,
    mode: Mode = "text",
    *,
    trial: bool = False,
) -> tuple[str, str]:
    """Вернуть (model_id, reasoning). Никогда не бросает; если каталог пуст — пустая строка."""
    reasoning_parts: list[str] = [f"tier={tier} mode={mode} trial={trial}"]
    for try_tier in _fallback_order(tier, trial):
        picked = pick_first_available(db, mode, try_tier)
        if not picked:
            reasoning_parts.append(f"no_candidates({try_tier})")
            continue
        if trial and _pricing_per_m(db, picked) > TRIAL_MAX_COMPLETION_PER_M:
            reasoning_parts.append(f"skip({picked}:trial_over_budget)")
            continue
        if try_tier != (tier if tier != "auto" else "mid"):
            reasoning_parts.append(f"fallback_to({try_tier})")
        reasoning_parts.append(f"picked={picked}")
        return picked, " | ".join(reasoning_parts)
    reasoning_parts.append("no_model_found")
    return "", " | ".join(reasoning_parts)


def helper_for(db: DBManager, mode: Mode = "text") -> str:
    """Helper-модель для промежуточных шагов advanced-режима (классификация, критика, перевод)."""
    picked = pick_first_available(db, mode, "helper")
    if picked:
        return picked
    return pick_first_available(db, mode, "fast") or ""


def visible_tiers_for_ui() -> list[dict]:
    """Для фронта: список тиров с человечными лейблами, без имён моделей."""
    return [
        {"id": "auto", "label": "Авто"},
        {"id": "fast", "label": "Повседневный"},
        {"id": "mid", "label": "Средний"},
        {"id": "advanced", "label": "Продвинутый"},
    ]


def catalog_summary() -> dict:
    """Сводка каталога для админки (без цен — цены подставляет healthcheck)."""
    return {
        mode: {tier: list(ids) for tier, ids in tiers.items()}
        for mode, tiers in CATALOG.items()
    }
