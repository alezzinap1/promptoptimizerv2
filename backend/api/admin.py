"""Admin API — users, trial reset, block, metrics, model-health (beta)."""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from backend.deps import get_db, require_admin
from config.abuse import check_admin_api_rate_limit
from config.settings import TRIAL_MAX_COMPLETION_PER_M, TRIAL_TOKENS_LIMIT
from db.manager import DBManager
from services.admin_event_sanitize import sanitize_event_payload
from services.model_health import ensure_fresh, run_health_check
from core.model_catalog import MAX_COMPLETION_PER_M, MAX_COMPLETION_PER_M_IMAGE
from services.model_router import catalog_summary
from services.trial_budget import effective_trial_tokens_limit, effective_session_generation_budget

router = APIRouter()


def _admin_rate_guard(admin: dict) -> None:
    ok, err = check_admin_api_rate_limit(int(admin["id"]))
    if not ok:
        raise HTTPException(429, err)


def _user_public(u: dict) -> dict:
    return {k: v for k, v in u.items() if k != "password_hash"}


@router.get("/users")
def admin_list_users(
    q: str | None = Query(None),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    admin: dict = Depends(require_admin),
    db: DBManager = Depends(get_db),
):
    _admin_rate_guard(admin)
    items, total = db.list_users_admin(q=q, limit=limit, offset=offset)
    return {"items": items, "total": total}


@router.get("/users/{user_id}")
def admin_get_user(
    user_id: int,
    admin: dict = Depends(require_admin),
    db: DBManager = Depends(get_db),
):
    _admin_rate_guard(admin)
    u = db.get_user_by_id(user_id)
    if not u:
        raise HTTPException(404, "User not found")
    usage = db.get_user_usage(user_id)
    has_own_key = bool(db.get_user_openrouter_api_key(user_id))
    eff_tokens = effective_trial_tokens_limit(usage)
    eff_sess = effective_session_generation_budget(usage)
    trial_remaining = max(0, eff_tokens - usage["tokens_used"]) if not has_own_key else None
    return {
        "user": _user_public(u),
        "usage": usage,
        "trial": {
            "tokens_limit_global": TRIAL_TOKENS_LIMIT,
            "tokens_limit_effective": eff_tokens,
            "tokens_remaining": trial_remaining,
            "max_completion_per_m": TRIAL_MAX_COMPLETION_PER_M,
            "has_own_api_key": has_own_key,
            "session_generation_budget_effective": eff_sess,
            "overrides": {
                "trial_tokens_limit": usage.get("trial_tokens_limit"),
                "rate_limit_rpm": usage.get("rate_limit_rpm"),
                "session_generation_budget": usage.get("session_generation_budget"),
            },
        },
    }


@router.post("/users/{user_id}/block")
def admin_block_user(
    user_id: int,
    admin: dict = Depends(require_admin),
    db: DBManager = Depends(get_db),
):
    _admin_rate_guard(admin)
    if not db.get_user_by_id(user_id):
        raise HTTPException(404, "User not found")
    db.set_user_blocked(user_id, True)
    db.log_admin_audit(int(admin["id"]), "user.block", user_id, {"blocked": True})
    return {"ok": True}


@router.post("/users/{user_id}/unblock")
def admin_unblock_user(
    user_id: int,
    admin: dict = Depends(require_admin),
    db: DBManager = Depends(get_db),
):
    _admin_rate_guard(admin)
    if not db.get_user_by_id(user_id):
        raise HTTPException(404, "User not found")
    db.set_user_blocked(user_id, False)
    db.log_admin_audit(int(admin["id"]), "user.unblock", user_id, {"blocked": False})
    return {"ok": True}


@router.patch("/users/{user_id}/limits")
def admin_patch_user_limits(
    user_id: int,
    admin: dict = Depends(require_admin),
    db: DBManager = Depends(get_db),
    body: dict = Body(default_factory=dict),
):
    """Set per-user trial token cap, RPM, session generation budget (JSON null clears override)."""
    _admin_rate_guard(admin)
    if not db.get_user_by_id(user_id):
        raise HTTPException(404, "User not found")
    updates: dict = {}
    for key in ("trial_tokens_limit", "rate_limit_rpm", "session_generation_budget"):
        if key not in body:
            continue
        val = body[key]
        if val is None:
            updates[key] = None
            continue
        try:
            iv = int(val)
        except (TypeError, ValueError):
            raise HTTPException(400, f"Invalid integer for {key}") from None
        if iv < 0:
            raise HTTPException(400, f"{key} must be non-negative")
        updates[key] = iv
    if not updates:
        raise HTTPException(400, "No limit fields in body")
    db.update_user_usage_limits(user_id, updates)
    db.log_admin_audit(int(admin["id"]), "user.limits_update", user_id, {k: updates[k] for k in updates})
    return {"ok": True, "usage": db.get_user_usage(user_id)}


@router.post("/users/{user_id}/reset-trial-usage")
def admin_reset_trial_usage(
    user_id: int,
    admin: dict = Depends(require_admin),
    db: DBManager = Depends(get_db),
):
    _admin_rate_guard(admin)
    if not db.get_user_by_id(user_id):
        raise HTTPException(404, "User not found")
    db.reset_user_trial_usage(user_id)
    db.log_admin_audit(int(admin["id"]), "user.reset_trial_usage", user_id, {})
    return {"ok": True}


@router.get("/users/{user_id}/events")
def admin_user_events(
    user_id: int,
    limit: int = Query(50, ge=1, le=200),
    admin: dict = Depends(require_admin),
    db: DBManager = Depends(get_db),
):
    _admin_rate_guard(admin)
    if not db.get_user_by_id(user_id):
        raise HTTPException(404, "User not found")
    raw = db.get_recent_events(limit=limit, user_id=user_id)
    events = []
    for row in raw:
        name = row.get("event_name", "")
        payload = row.get("payload") or {}
        events.append(
            {
                "id": row.get("id"),
                "event_name": name,
                "created_at": row.get("created_at"),
                "session_id": row.get("session_id"),
                "payload": sanitize_event_payload(name, payload),
            }
        )
    return {"events": events}


def _parse_ts(value) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


@router.get("/metrics")
def admin_metrics(
    admin: dict = Depends(require_admin),
    db: DBManager = Depends(get_db),
):
    """Aggregated metrics for admin dashboard. Все цифры без текста промптов."""
    _admin_rate_guard(admin)
    now = datetime.now(timezone.utc)
    d1 = now - timedelta(days=1)
    d7 = now - timedelta(days=7)
    d30 = now - timedelta(days=30)

    with db._conn() as conn:  # noqa: SLF001
        users_total = int(conn.execute("SELECT COUNT(*) FROM users").fetchone()[0])
        blocked = int(
            conn.execute("SELECT COUNT(*) FROM users WHERE COALESCE(is_blocked,0)=1").fetchone()[0]
        )
        admins = int(
            conn.execute("SELECT COUNT(*) FROM users WHERE COALESCE(is_admin,0)=1").fetchone()[0]
        )
        with_key = int(
            conn.execute(
                "SELECT COUNT(*) FROM user_preferences WHERE COALESCE(openrouter_api_key,'') <> ''"
            ).fetchone()[0]
        )
        tokens_total = int(
            conn.execute("SELECT COALESCE(SUM(tokens_used),0) FROM user_usage").fetchone()[0]
        )
        dollars_total = float(
            conn.execute("SELECT COALESCE(SUM(dollars_used),0) FROM user_usage").fetchone()[0]
        )
        users_new_7d = int(
            conn.execute(
                "SELECT COUNT(*) FROM users WHERE datetime(created_at) >= datetime(?)",
                (d7.isoformat(),),
            ).fetchone()[0]
        )
        users_new_30d = int(
            conn.execute(
                "SELECT COUNT(*) FROM users WHERE datetime(created_at) >= datetime(?)",
                (d30.isoformat(),),
            ).fetchone()[0]
        )
        users_active_1d = int(
            conn.execute(
                """SELECT COUNT(DISTINCT user_id) FROM user_sessions
                   WHERE datetime(updated_at) >= datetime(?)""",
                (d1.isoformat(),),
            ).fetchone()[0]
        )
        users_active_7d = int(
            conn.execute(
                """SELECT COUNT(DISTINCT user_id) FROM user_sessions
                   WHERE datetime(updated_at) >= datetime(?)""",
                (d7.isoformat(),),
            ).fetchone()[0]
        )
        events_7d_rows = conn.execute(
            """SELECT event_name, COUNT(*) AS c FROM app_events
               WHERE datetime(created_at) >= datetime(?)
               GROUP BY event_name ORDER BY c DESC LIMIT 20""",
            (d7.isoformat(),),
        ).fetchall()
        events_1d = int(
            conn.execute(
                "SELECT COUNT(*) FROM app_events WHERE datetime(created_at) >= datetime(?)",
                (d1.isoformat(),),
            ).fetchone()[0]
        )
        events_7d_total = int(
            conn.execute(
                "SELECT COUNT(*) FROM app_events WHERE datetime(created_at) >= datetime(?)",
                (d7.isoformat(),),
            ).fetchone()[0]
        )
        trial_exhausted = int(
            conn.execute(
                """
                SELECT COUNT(*) FROM user_usage uu
                WHERE uu.tokens_used >= COALESCE(uu.trial_tokens_limit, ?)
                """,
                (TRIAL_TOKENS_LIMIT,),
            ).fetchone()[0]
        )
        top_users = conn.execute(
            """
            SELECT u.id, u.username, COALESCE(uu.tokens_used,0) AS tokens_used,
                   COALESCE(uu.dollars_used,0) AS dollars_used
            FROM users u
            LEFT JOIN user_usage uu ON uu.user_id = u.id
            ORDER BY tokens_used DESC LIMIT 5
            """
        ).fetchall()

    return {
        "generated_at": int(time.time()),
        "users": {
            "total": users_total,
            "admins": admins,
            "blocked": blocked,
            "with_own_key": with_key,
            "new_7d": users_new_7d,
            "new_30d": users_new_30d,
            "active_1d": users_active_1d,
            "active_7d": users_active_7d,
            "trial_exhausted": trial_exhausted,
        },
        "usage": {
            "tokens_total": tokens_total,
            "dollars_total": round(dollars_total, 6),
            "trial_tokens_limit_global": TRIAL_TOKENS_LIMIT,
            "trial_max_completion_per_m": TRIAL_MAX_COMPLETION_PER_M,
        },
        "events": {
            "last_1d": events_1d,
            "last_7d": events_7d_total,
            "by_name_7d": [{"event": r["event_name"], "count": int(r["c"])} for r in events_7d_rows],
        },
        "top_users_by_tokens": [
            {
                "id": r["id"],
                "username": r["username"],
                "tokens_used": int(r["tokens_used"]),
                "dollars_used": round(float(r["dollars_used"]), 6),
            }
            for r in top_users
        ],
    }


@router.get("/model-health")
def admin_model_health(
    admin: dict = Depends(require_admin),
    db: DBManager = Depends(get_db),
):
    """Snapshot здоровья моделей каталога + история замен."""
    _admin_rate_guard(admin)
    ensure_fresh(db)
    rows = db.list_model_health()
    events = db.list_model_health_events(limit=50)
    last_checked = None
    for r in rows:
        dt = _parse_ts(r.get("last_checked_at"))
        if dt and (last_checked is None or dt > last_checked):
            last_checked = dt
    return {
        "catalog": catalog_summary(),
        "items": rows,
        "events": events,
        "last_checked_at": last_checked.isoformat() if last_checked else None,
        "completion_budget_caps_usd_per_million": {
            "text": MAX_COMPLETION_PER_M,
            "skill": MAX_COMPLETION_PER_M,
            "image": MAX_COMPLETION_PER_M_IMAGE,
            "helper": None,
        },
    }


@router.post("/model-health/run")
def admin_model_health_run(
    admin: dict = Depends(require_admin),
    db: DBManager = Depends(get_db),
):
    """Принудительно запустить healthcheck сейчас."""
    _admin_rate_guard(admin)
    summary = run_health_check(db)
    db.log_admin_audit(int(admin["id"]), "model_health.run", None, {"summary": summary})
    return {"ok": True, "summary": summary}


_VALID_MODES = {"text", "image", "skill"}
_VALID_TIERS_FOR_OVERRIDE = {"fast", "mid", "advanced", "helper"}


@router.get("/tier-overrides")
def admin_list_tier_overrides(
    admin: dict = Depends(require_admin),
    db: DBManager = Depends(get_db),
):
    """
    Текущие ручные оверрайды + кандидаты из каталога и здоровье моделей —
    всё нужное, чтобы админ одним экраном выбрал модель под (mode, tier).
    """
    _admin_rate_guard(admin)
    overrides = db.get_tier_overrides()
    health_slots: dict[tuple[str, str, str], dict] = {}
    for row in db.list_model_health():
        health_slots[(row["model_id"], row["mode"], row["tier"])] = row
    catalog = catalog_summary()
    override_map = {(o["mode"], o["tier"]): o["model_id"] for o in overrides}
    rows: list[dict] = []
    for mode, tiers in catalog.items():
        for tier, ids in tiers.items():
            candidates = [
                {
                    "id": mid,
                    "available": bool((health_slots.get((mid, mode, tier)) or {}).get("available", 0)),
                    "reason": (health_slots.get((mid, mode, tier)) or {}).get("reason") or "",
                    "price_completion_per_m": (
                        float((health_slots.get((mid, mode, tier)) or {}).get("last_pricing_completion") or 0.0)
                        * 1_000_000.0
                    ),
                }
                for mid in ids
            ]
            rows.append(
                {
                    "mode": mode,
                    "tier": tier,
                    "override": override_map.get((mode, tier), ""),
                    "candidates": candidates,
                }
            )
    return {"rows": rows}


@router.put("/tier-overrides")
def admin_set_tier_override(
    admin: dict = Depends(require_admin),
    db: DBManager = Depends(get_db),
    mode: str = Body(..., embed=True),
    tier: str = Body(..., embed=True),
    model_id: str | None = Body(None, embed=True),
):
    """Задать или сбросить (mode, tier) → model_id. `model_id=null` → авто (каталог+health)."""
    _admin_rate_guard(admin)
    if mode not in _VALID_MODES:
        raise HTTPException(400, f"mode must be one of {sorted(_VALID_MODES)}")
    if tier not in _VALID_TIERS_FOR_OVERRIDE:
        raise HTTPException(400, f"tier must be one of {sorted(_VALID_TIERS_FOR_OVERRIDE)}")
    cleaned = (model_id or "").strip() or None
    if cleaned:
        catalog = catalog_summary()
        valid_ids = set(catalog.get(mode, {}).get(tier, []))
        if cleaned not in valid_ids:
            raise HTTPException(400, f"model_id must be one of catalog candidates for {mode}/{tier}")
    db.set_tier_override(mode, tier, cleaned)
    db.log_admin_audit(
        int(admin["id"]),
        "tier_override.set",
        None,
        {"mode": mode, "tier": tier, "model_id": cleaned or ""},
    )
    return {"ok": True, "mode": mode, "tier": tier, "model_id": cleaned or ""}


@router.get("/community")
def admin_list_community(
    visibility: str = Query("all"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    admin: dict = Depends(require_admin),
    db: DBManager = Depends(get_db),
):
    """Модерация ленты: все посты или только публичные / скрытые (is_public)."""
    _admin_rate_guard(admin)
    v = (visibility or "all").lower()
    if v not in ("all", "public", "hidden"):
        raise HTTPException(400, "visibility must be all, public, or hidden")
    items, total = db.list_community_prompts_admin(visibility=v, limit=limit, offset=offset)
    return {"items": items, "total": total}


@router.patch("/community/{prompt_id}")
def admin_patch_community_public(
    prompt_id: int,
    admin: dict = Depends(require_admin),
    db: DBManager = Depends(get_db),
    body: dict = Body(default_factory=dict),
):
    """Скрыть пост из публичной ленты (is_public=0) или вернуть (is_public=1)."""
    _admin_rate_guard(admin)
    if "is_public" not in body:
        raise HTTPException(400, "is_public required (0 or 1)")
    raw = body["is_public"]
    if raw in (True, 1, "1", "true", "True"):
        val = 1
    elif raw in (False, 0, "0", "false", "False"):
        val = 0
    else:
        raise HTTPException(400, "is_public must be 0 or 1")
    if not db.admin_set_community_public(prompt_id, val):
        raise HTTPException(404, "Community prompt not found")
    db.log_admin_audit(
        int(admin["id"]),
        "community.public",
        None,
        {"prompt_id": prompt_id, "is_public": val},
    )
    return {"ok": True, "is_public": val}
