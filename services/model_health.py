"""
Healthcheck каталога моделей.

- `run_health_check(db)` — по каждой ячейке `CATALOG` (model_id, mode, tier), сверка с OpenRouter.
- `is_available(db, model_id, mode, tier)` — по строке слота; без строки в БД слот считается недоступным для auto-пути.
- `ensure_fresh(db, max_age_sec)` — при устаревании снапшота запускает проверку.
"""
from __future__ import annotations

import logging
import math
import time
from datetime import datetime, timezone

from core.model_catalog import CATALOG, candidates, completion_budget_cap_per_m
from db.manager import DBManager
from services.openrouter_models import get_models

logger = logging.getLogger(__name__)

_DEFAULT_MAX_AGE_SEC = 24 * 60 * 60


def _price_per_m(price_per_token: float | None) -> float:
    if not price_per_token:
        return 0.0
    return float(price_per_token) * 1_000_000.0


def _index_openrouter_models() -> dict[str, dict]:
    out: dict[str, dict] = {}
    for m in get_models().get("data", []) or []:
        mid = m.get("id")
        if mid:
            out[mid] = m
    return out


def _evaluate(model_id: str, mode: str, tier: str, index: dict[str, dict]) -> dict:
    row = index.get(model_id)
    if not row:
        return {
            "available": False,
            "reason": "not_in_openrouter",
            "pricing_prompt": None,
            "pricing_completion": None,
        }
    pricing = (row.get("pricing") or {})
    pp = pricing.get("prompt") or pricing.get("input")
    cp = pricing.get("completion") or pricing.get("output")
    try:
        pp_f = float(pp) if pp is not None else None
    except (TypeError, ValueError):
        pp_f = None
    try:
        cp_f = float(cp) if cp is not None else None
    except (TypeError, ValueError):
        cp_f = None

    comp_per_m = _price_per_m(cp_f)
    cap = completion_budget_cap_per_m(mode, tier)
    if math.isfinite(cap) and comp_per_m > cap:
        return {
            "available": False,
            "reason": f"over_budget({comp_per_m:.2f}/1M>{cap:g})",
            "pricing_prompt": pp_f,
            "pricing_completion": cp_f,
        }
    return {
        "available": True,
        "reason": "ok",
        "pricing_prompt": pp_f,
        "pricing_completion": cp_f,
    }


def _pick_swap_target(
    mids: list[str],
    broken_id: str,
    mode: str,
    tier: str,
    index: dict[str, dict],
) -> str | None:
    """Среди доступных альтернатив в том же тире — самая дешёвая по completion, затем порядок в каталоге."""
    options: list[tuple[float, int, str]] = []
    for ord_i, alt in enumerate(mids):
        if alt == broken_id:
            continue
        alt_res = _evaluate(alt, mode, tier, index)
        if not alt_res["available"]:
            continue
        cp = alt_res.get("pricing_completion")
        try:
            cp_t = float(cp) if cp is not None else 0.0
        except (TypeError, ValueError):
            cp_t = 0.0
        comp_per_m = _price_per_m(cp_t)
        options.append((comp_per_m, ord_i, alt))
    if not options:
        return None
    options.sort(key=lambda x: (x[0], x[1]))
    return options[0][2]


def run_health_check(db: DBManager) -> dict:
    """Проверить все модели каталога. Возвращает сводку; пишет в БД."""
    index = _index_openrouter_models()
    checked = 0
    unavailable: list[str] = []
    swaps: list[dict] = []
    per_tier_available: dict[str, list[str]] = {}

    for mode, tiers in CATALOG.items():
        for tier, ids in tiers.items():
            key = f"{mode}:{tier}"
            for mid in ids:
                checked += 1
                result = _evaluate(mid, mode, tier, index)
                swapped_to: str | None = None
                if not result["available"]:
                    unavailable.append(mid)
                    swapped_to = _pick_swap_target(ids, mid, mode, tier, index)
                    if swapped_to:
                        swaps.append({"from": mid, "to": swapped_to, "mode": mode, "tier": tier})
                    db.log_model_health_event(
                        mid,
                        "unavailable",
                        f"{mode}/{tier}: {result['reason']}"
                        + (f" → swap {swapped_to}" if swapped_to else ""),
                    )
                db.upsert_model_health(
                    model_id=mid,
                    mode=mode,
                    tier=tier,
                    available=bool(result["available"]),
                    reason=str(result["reason"]),
                    pricing_prompt=result["pricing_prompt"],
                    pricing_completion=result["pricing_completion"],
                    swapped_to=swapped_to,
                )
                if result["available"]:
                    per_tier_available.setdefault(key, []).append(mid)

    summary = {
        "checked_at": int(time.time()),
        "checked": checked,
        "unavailable": len(unavailable),
        "swaps": swaps,
        "available_by_tier": per_tier_available,
    }
    logger.info(
        "model_health: checked=%d unavailable=%d swaps=%d",
        summary["checked"],
        summary["unavailable"],
        len(swaps),
    )
    return summary


def ensure_fresh(db: DBManager, max_age_sec: int = _DEFAULT_MAX_AGE_SEC) -> bool:
    """Запустить healthcheck, если последний снапшот старше max_age_sec. Возвращает True если запустили."""
    rows = db.list_model_health()
    if not rows:
        run_health_check(db)
        return True
    newest: datetime | None = None
    for r in rows:
        ts = r.get("last_checked_at")
        if not ts:
            continue
        try:
            dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if newest is None or dt > newest:
                newest = dt
        except ValueError:
            continue
    if newest is None:
        run_health_check(db)
        return True
    age = (datetime.now(timezone.utc) - newest).total_seconds()
    if age >= max_age_sec:
        run_health_check(db)
        return True
    return False


def _health_slot_map(db: DBManager) -> dict[tuple[str, str, str], dict]:
    out: dict[tuple[str, str, str], dict] = {}
    for r in db.list_model_health():
        out[(str(r["model_id"]), str(r["mode"]), str(r["tier"]))] = dict(r)
    return out


def is_available(db: DBManager, model_id: str, mode: str, tier: str) -> bool:
    row = db.get_model_health_slot(model_id, mode, tier)
    if not row:
        return False
    return bool(row.get("available"))


def pick_first_available(db: DBManager, mode: str, tier: str) -> str | None:
    """Первый доступный id из (mode, tier) по порядку каталога; без строки health — слот считается недоступным."""
    ids = candidates(mode, tier)  # type: ignore[arg-type]
    if not ids:
        return None
    hmap = _health_slot_map(db)
    for mid in ids:
        row = hmap.get((mid, mode, tier))
        if row and int(row.get("available") or 0):
            return mid
    return None


def swap_suggestion(db: DBManager, mode: str, tier: str, broken_id: str) -> str | None:
    """Следующий доступный кандидат в том же (mode, tier), кроме broken_id (дешевле среди доступных)."""
    ids = candidates(mode, tier)  # type: ignore[arg-type]
    index = _index_openrouter_models()
    return _pick_swap_target(ids, broken_id, mode, tier, index)
