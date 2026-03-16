"""Auth API for the React web app."""
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from backend.deps import get_current_user, get_db
from db.manager import DBManager
from services.auth_service import generate_session_id, hash_password, normalize_username, verify_password

router = APIRouter()


class AuthRequest(BaseModel):
    username: str
    password: str


def _validate_credentials(username: str, password: str) -> tuple[str, str]:
    normalized = normalize_username(username)
    if len(normalized) < 3:
        raise HTTPException(400, "Username must be at least 3 chars")
    if len(password) < 8:
        raise HTTPException(400, "Password must be at least 8 chars")
    return normalized, password


def _auth_response(user: dict, session_id: str) -> dict:
    return {
        "session_id": session_id,
        "user": {
            "id": int(user["id"]),
            "username": str(user["username"]),
        },
    }


@router.post("/auth/register")
def register(req: AuthRequest, db: DBManager = Depends(get_db)):
    username, password = _validate_credentials(req.username, req.password)
    try:
        user_id = db.create_user(username, hash_password(password))
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Username already exists") from None
    user = db.get_user_by_id(int(user_id))
    if not user:
        raise HTTPException(500, "Failed to load created user")
    session_id = generate_session_id()
    db.bind_session_to_user(session_id, int(user["id"]))
    return _auth_response(user, session_id)


@router.post("/auth/login")
def login(req: AuthRequest, db: DBManager = Depends(get_db)):
    username = normalize_username(req.username)
    user = db.get_user_by_username(username)
    if not user or not verify_password(req.password, user.get("password_hash", "")):
        raise HTTPException(401, "Invalid username or password")
    session_id = generate_session_id()
    db.bind_session_to_user(session_id, int(user["id"]))
    return _auth_response(user, session_id)


@router.post("/auth/logout")
def logout(
    x_session_id: str | None = Header(default=None, alias="X-Session-Id"),
    db: DBManager = Depends(get_db),
):
    if x_session_id:
        db.clear_session_binding(x_session_id)
    return {"ok": True}


@router.get("/auth/me")
def me(user: dict = Depends(get_current_user)):
    return {"user": {"id": int(user["id"]), "username": str(user["username"])}}
