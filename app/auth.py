"""
Authentication helpers for Streamlit UI.

Phase 2 goal:
- local username/password auth
- bind Streamlit session_id to user_id
- enforce per-user data isolation in pages
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import os

import streamlit as st

from db.manager import DBManager


PBKDF2_ITERATIONS = 200_000


def _hash_password(password: str, salt: bytes | None = None) -> str:
    """Create PBKDF2 hash in storage format: pbkdf2_sha256$iters$salt$b64hash."""
    used_salt = salt or os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), used_salt, PBKDF2_ITERATIONS)
    return (
        f"pbkdf2_sha256${PBKDF2_ITERATIONS}$"
        f"{base64.b64encode(used_salt).decode('ascii')}$"
        f"{base64.b64encode(dk).decode('ascii')}"
    )


def _verify_password(password: str, encoded: str) -> bool:
    """Verify password against encoded PBKDF2 hash."""
    try:
        alg, iterations, salt_b64, hash_b64 = encoded.split("$", 3)
        if alg != "pbkdf2_sha256":
            return False
        salt = base64.b64decode(salt_b64.encode("ascii"))
        expected = base64.b64decode(hash_b64.encode("ascii"))
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations))
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def _set_current_user(user: dict) -> None:
    """Cache authenticated user in session state."""
    st.session_state["auth_user_id"] = int(user["id"])
    st.session_state["auth_username"] = str(user["username"])


def get_current_user_id() -> int | None:
    """Return current authenticated user id from session state."""
    value = st.session_state.get("auth_user_id")
    return int(value) if value is not None else None


def require_auth(db: DBManager) -> dict:
    """
    Gate all app pages by authentication.

    If session has no bound user, renders login/register form and stops execution.
    Returns current user when authenticated.
    """
    session_id = st.session_state.get("session_id", "")
    if not session_id:
        st.session_state["session_id"] = str(__import__("uuid").uuid4())
        session_id = st.session_state["session_id"]

    # Restore from DB binding if already authenticated in this session.
    if "auth_user_id" not in st.session_state:
        user = db.get_session_user(session_id)
        if user:
            _set_current_user(user)

    if "auth_user_id" in st.session_state:
        return {
            "id": int(st.session_state["auth_user_id"]),
            "username": str(st.session_state.get("auth_username", "")),
        }

    st.title("Sign in")
    st.caption("Phase 2: user auth and per-user data isolation are enabled.")
    tab_login, tab_register = st.tabs(["Login", "Register"])

    with tab_login:
        with st.form("login_form"):
            username = st.text_input("Username", placeholder="your_name").strip().lower()
            password = st.text_input("Password", type="password")
            submitted = st.form_submit_button("Login", use_container_width=True, type="primary")
            if submitted:
                user = db.get_user_by_username(username)
                if not user or not _verify_password(password, user.get("password_hash", "")):
                    st.error("Invalid username or password.")
                else:
                    db.bind_session_to_user(session_id, int(user["id"]))
                    _set_current_user(user)
                    st.success("Logged in.")
                    st.rerun()

    with tab_register:
        with st.form("register_form"):
            username = st.text_input("New username", placeholder="your_name").strip().lower()
            password = st.text_input("New password", type="password")
            password2 = st.text_input("Repeat password", type="password")
            submitted = st.form_submit_button("Create account", use_container_width=True)
            if submitted:
                if len(username) < 3:
                    st.error("Username must be at least 3 chars.")
                elif len(password) < 8:
                    st.error("Password must be at least 8 chars.")
                elif password != password2:
                    st.error("Passwords do not match.")
                else:
                    try:
                        user_id = db.create_user(username, _hash_password(password))
                    except Exception:
                        st.error("Username already exists.")
                    else:
                        user = db.get_user_by_id(int(user_id))
                        if user:
                            db.bind_session_to_user(session_id, int(user["id"]))
                            _set_current_user(user)
                            st.success("Account created and logged in.")
                            st.rerun()

    st.stop()


def render_user_menu(db: DBManager) -> None:
    """Render lightweight user status + logout button in sidebar area."""
    user_id = get_current_user_id()
    if not user_id:
        return
    username = st.session_state.get("auth_username", "")
    c1, c2 = st.columns([3, 1])
    with c1:
        st.caption(f"User: `{username}`")
    with c2:
        if st.button("Logout", use_container_width=True):
            db.clear_session_binding(st.session_state.get("session_id", ""))
            for key in ("auth_user_id", "auth_username", "last_result", "iteration_mode"):
                if key in st.session_state:
                    st.session_state.pop(key)
            st.rerun()
