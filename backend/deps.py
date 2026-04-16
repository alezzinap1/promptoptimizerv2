"""
Shared FastAPI dependencies.
"""
from __future__ import annotations

from fastapi import Depends, Header, HTTPException

from config.settings import DB_PATH
from core.technique_registry import TechniqueRegistry
from db.manager import DBManager
from services.technique_catalog import get_user_registry


def get_db() -> DBManager:
    db = DBManager(db_path=DB_PATH)
    db.init()
    return db


def get_session_id(
    x_session_id: str | None = Header(default=None, alias="X-Session-Id"),
) -> str | None:
    return x_session_id or None


def get_current_user(
    x_session_id: str | None = Header(default=None, alias="X-Session-Id"),
) -> dict:
    if not x_session_id:
        raise HTTPException(401, "Authentication required")
    db = get_db()
    user = db.get_session_user(x_session_id)
    if not user:
        raise HTTPException(401, "Invalid session")
    if int(user.get("is_blocked") or 0):
        raise HTTPException(403, "Account disabled")
    return user


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if not int(user.get("is_admin") or 0):
        raise HTTPException(403, "Admin only")
    return user


def get_registry_for_user(
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
) -> TechniqueRegistry:
    return get_user_registry(db, int(user["id"]))
