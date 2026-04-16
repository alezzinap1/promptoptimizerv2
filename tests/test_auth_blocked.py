"""Blocked users cannot log in or use API with session."""
from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from db.manager import DBManager
from services.auth_service import generate_session_id, hash_password


def test_blocked_user_me_returns_403() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "t.db"
        db = DBManager(str(db_path))
        db.init()
        uid = db.create_user("blockeduser", hash_password("password12345"))
        with db._conn() as conn:  # noqa: SLF001 — test-only direct update
            conn.execute("UPDATE users SET is_blocked = 1 WHERE id = ?", (uid,))
        sid = generate_session_id()
        db.bind_session_to_user(sid, int(uid))

        with patch("backend.deps.DB_PATH", str(db_path)):
            from backend.main import app

            client = TestClient(app)
            r = client.get("/api/auth/me", headers={"X-Session-Id": sid})
            assert r.status_code == 403


def test_blocked_user_login_returns_403() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "t.db"
        db = DBManager(str(db_path))
        db.init()
        uid = db.create_user("blocked2", hash_password("password12345"))
        with db._conn() as conn:  # noqa: SLF001
            conn.execute("UPDATE users SET is_blocked = 1 WHERE id = ?", (uid,))

        with patch("backend.deps.DB_PATH", str(db_path)):
            from backend.main import app

            client = TestClient(app)
            r = client.post(
                "/api/auth/login",
                json={"username": "blocked2", "password": "password12345"},
            )
            assert r.status_code == 403
