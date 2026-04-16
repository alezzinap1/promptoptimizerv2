"""Auth API for the React web app."""
from __future__ import annotations

import re
import secrets
import sqlite3
import time
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from backend.deps import get_current_user, get_db
from config.abuse import check_auth_login_rate_limit, check_auth_register_rate_limit
from config.settings import FRONTEND_URL, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
from db.manager import DBManager
from services.auth_service import generate_session_id, hash_password, normalize_username, verify_password

router = APIRouter()

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# ── GitHub OAuth in-memory CSRF state store ───────────────────────────────────
# Maps state → expiry (unix ts). Cleaned up lazily.
_github_states: dict[str, float] = {}
_GITHUB_STATE_TTL = 600  # 10 minutes


def _new_github_state() -> str:
    state = secrets.token_urlsafe(24)
    _github_states[state] = time.time() + _GITHUB_STATE_TTL
    return state


def _verify_github_state(state: str) -> bool:
    expiry = _github_states.pop(state, None)
    # Cleanup stale states
    now = time.time()
    stale = [k for k, v in _github_states.items() if v < now]
    for k in stale:
        _github_states.pop(k, None)
    return expiry is not None and expiry > now


class AuthRequest(BaseModel):
    username: str
    password: str
    email: str | None = None


class UpdateEmailRequest(BaseModel):
    email: str


def _validate_credentials(username: str, password: str) -> tuple[str, str]:
    normalized = normalize_username(username)
    if len(normalized) < 3:
        raise HTTPException(400, "Username must be at least 3 chars")
    if len(password) < 8:
        raise HTTPException(400, "Password must be at least 8 chars")
    return normalized, password


def _validate_email(email: str) -> str:
    email = email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "Invalid email address")
    return email


def _auth_response(user: dict, session_id: str) -> dict:
    return {
        "session_id": session_id,
        "user": {
            "id": int(user["id"]),
            "username": str(user["username"]),
            "email": user.get("email"),
            "avatar_url": user.get("avatar_url"),
            "is_admin": bool(int(user.get("is_admin") or 0)),
        },
    }


@router.post("/auth/register")
def register(req: AuthRequest, request: Request, db: DBManager = Depends(get_db)):
    ok, err = check_auth_register_rate_limit(request)
    if not ok:
        raise HTTPException(429, err)
    username, password = _validate_credentials(req.username, req.password)

    email: str | None = None
    if req.email:
        email = _validate_email(req.email)

    try:
        user_id = db.create_user(username, hash_password(password), email=email)
    except sqlite3.IntegrityError as e:
        msg = str(e)
        if "email" in msg:
            raise HTTPException(409, "Email already in use") from None
        raise HTTPException(409, "Username already exists") from None
    user = db.get_user_by_id(int(user_id))
    if not user:
        raise HTTPException(500, "Failed to load created user")
    session_id = generate_session_id()
    db.bind_session_to_user(session_id, int(user["id"]))
    return _auth_response(user, session_id)


@router.post("/auth/login")
def login(req: AuthRequest, request: Request, db: DBManager = Depends(get_db)):
    ok, err = check_auth_login_rate_limit(request)
    if not ok:
        raise HTTPException(429, err)
    username = normalize_username(req.username)
    user = db.get_user_by_username(username)
    if not user or not verify_password(req.password, user.get("password_hash", "")):
        raise HTTPException(401, "Invalid username or password")
    if int(user.get("is_blocked") or 0):
        raise HTTPException(403, "Account disabled")
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
    return {
        "user": {
            "id": int(user["id"]),
            "username": str(user["username"]),
            "email": user.get("email"),
            "avatar_url": user.get("avatar_url"),
            "is_admin": bool(int(user.get("is_admin") or 0)),
        }
    }


@router.patch("/auth/me/email")
def update_email(
    req: UpdateEmailRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    email = _validate_email(req.email)
    try:
        db.update_user_email(int(user["id"]), email)
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Email already in use") from None
    return {"ok": True, "email": email}


# ── GitHub OAuth ──────────────────────────────────────────────────────────────

@router.get("/auth/github")
def github_oauth_start():
    """Redirect user to GitHub authorization page."""
    if not GITHUB_CLIENT_ID:
        raise HTTPException(503, "GitHub OAuth not configured")
    state = _new_github_state()
    url = (
        f"https://github.com/login/oauth/authorize"
        f"?client_id={GITHUB_CLIENT_ID}"
        f"&scope=user%3Aemail"
        f"&state={state}"
    )
    return RedirectResponse(url)


def _github_exchange_code(code: str) -> str:
    """Exchange OAuth code for access token."""
    resp = httpx.post(
        "https://github.com/login/oauth/access_token",
        json={"client_id": GITHUB_CLIENT_ID, "client_secret": GITHUB_CLIENT_SECRET, "code": code},
        headers={"Accept": "application/json"},
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    token = data.get("access_token")
    if not token:
        raise ValueError(f"No access_token in GitHub response: {data}")
    return token


def _github_get_user(token: str) -> dict[str, Any]:
    resp = httpx.get(
        "https://api.github.com/user",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


def _github_get_primary_email(token: str) -> str | None:
    try:
        resp = httpx.get(
            "https://api.github.com/user/emails",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
            timeout=10,
        )
        resp.raise_for_status()
        emails = resp.json()
        for e in emails:
            if e.get("primary") and e.get("verified"):
                return e["email"]
        # Fallback: first verified
        for e in emails:
            if e.get("verified"):
                return e["email"]
    except Exception:
        pass
    return None


def _unique_username(db: DBManager, base: str) -> str:
    """Return base if available, otherwise base_2, base_3, ..."""
    candidate = base[:30].strip().lower()
    if not db.get_user_by_username(candidate):
        return candidate
    for i in range(2, 100):
        c = f"{candidate}_{i}"
        if not db.get_user_by_username(c):
            return c
    return f"{candidate}_{secrets.token_hex(4)}"


@router.get("/auth/github/callback")
def github_oauth_callback(code: str, state: str, db: DBManager = Depends(get_db)):
    """Handle GitHub callback: exchange code, upsert user, redirect to frontend."""
    error_redirect = f"{FRONTEND_URL}/login?error=github_failed"

    if not _verify_github_state(state):
        return RedirectResponse(f"{FRONTEND_URL}/login?error=github_state")

    try:
        token = _github_exchange_code(code)
        gh_user = _github_get_user(token)
    except Exception:
        return RedirectResponse(error_redirect)

    github_id = str(gh_user.get("id", ""))
    github_login = gh_user.get("login", "")
    avatar_url = gh_user.get("avatar_url")

    if not github_id or not github_login:
        return RedirectResponse(error_redirect)

    email = _github_get_primary_email(token)

    # Find or create user
    existing = db.get_user_by_github_id(github_id)
    if existing:
        user = existing
    else:
        username = _unique_username(db, github_login)
        try:
            user_id = db.create_github_user(
                username=username,
                github_id=github_id,
                github_login=github_login,
                email=email,
                avatar_url=avatar_url,
            )
        except sqlite3.IntegrityError:
            return RedirectResponse(error_redirect)
        user = db.get_user_by_id(int(user_id))
        if not user:
            return RedirectResponse(error_redirect)

    if int(user.get("is_blocked") or 0):
        return RedirectResponse(f"{FRONTEND_URL}/login?error=account_disabled")

    session_id = generate_session_id()
    db.bind_session_to_user(session_id, int(user["id"]))

    return RedirectResponse(f"{FRONTEND_URL}/login?session={session_id}")
