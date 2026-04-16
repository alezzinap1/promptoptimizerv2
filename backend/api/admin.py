"""Admin API — users, trial reset, block (beta)."""
from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, Query

from backend.deps import get_db, require_admin
from config.abuse import check_admin_api_rate_limit
from config.settings import TRIAL_MAX_COMPLETION_PER_M, TRIAL_TOKENS_LIMIT
from db.manager import DBManager
from services.admin_event_sanitize import sanitize_event_payload
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
