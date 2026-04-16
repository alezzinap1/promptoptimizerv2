"""Admin API access and behavior."""
from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from db.manager import DBManager
from services.auth_service import generate_session_id, hash_password


def test_non_admin_cannot_list_users() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "t.db"
        db = DBManager(str(db_path))
        db.init()
        uid = db.create_user("regular", hash_password("password12345"))
        sid = generate_session_id()
        db.bind_session_to_user(sid, int(uid))
        with patch("backend.deps.DB_PATH", str(db_path)):
            from backend.main import app

            client = TestClient(app)
            r = client.get("/api/admin/users", headers={"X-Session-Id": sid})
            assert r.status_code == 403


def test_admin_list_and_block_and_events() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "t.db"
        db = DBManager(str(db_path))
        db.init()
        admin_id = db.create_user("adminu", hash_password("password12345"))
        with db._conn() as conn:  # noqa: SLF001
            conn.execute("UPDATE users SET is_admin = 1 WHERE id = ?", (admin_id,))
        uid = db.create_user("victim", hash_password("password12345"))
        db.add_user_usage(uid, 50, 0.05)
        db.log_event("generate_requested", user_id=uid, session_id="s1", payload={"task_input": "SECRET"})

        admin_sid = generate_session_id()
        db.bind_session_to_user(admin_sid, int(admin_id))

        with patch("backend.deps.DB_PATH", str(db_path)):
            from backend.main import app

            client = TestClient(app)
            r = client.get("/api/admin/users", headers={"X-Session-Id": admin_sid})
            assert r.status_code == 200
            data = r.json()
            assert data["total"] >= 2

            r2 = client.get(f"/api/admin/users/{uid}", headers={"X-Session-Id": admin_sid})
            assert r2.status_code == 200
            assert r2.json()["usage"]["tokens_used"] == 50

            r3 = client.post(f"/api/admin/users/{uid}/block", headers={"X-Session-Id": admin_sid})
            assert r3.status_code == 200
            victim = db.get_user_by_id(uid)
            assert int(victim.get("is_blocked") or 0) == 1

            r4 = client.post(f"/api/admin/users/{uid}/reset-trial-usage", headers={"X-Session-Id": admin_sid})
            assert r4.status_code == 200
            assert db.get_user_usage(uid)["tokens_used"] == 0

            r5 = client.get(f"/api/admin/users/{uid}/events", headers={"X-Session-Id": admin_sid})
            assert r5.status_code == 200
            evs = r5.json()["events"]
            assert any(e["event_name"] == "generate_requested" for e in evs)
            gen_ev = next(e for e in evs if e["event_name"] == "generate_requested")
            assert "task_input" not in gen_ev["payload"]

            r6 = client.post(f"/api/admin/users/{uid}/unblock", headers={"X-Session-Id": admin_sid})
            assert r6.status_code == 200
            assert int(db.get_user_by_id(uid).get("is_blocked") or 0) == 0


def test_me_includes_is_admin() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "t.db"
        db = DBManager(str(db_path))
        db.init()
        uid = db.create_user("adm2", hash_password("password12345"))
        with db._conn() as conn:  # noqa: SLF001
            conn.execute("UPDATE users SET is_admin = 1 WHERE id = ?", (uid,))
        sid = generate_session_id()
        db.bind_session_to_user(sid, int(uid))
        with patch("backend.deps.DB_PATH", str(db_path)):
            from backend.main import app

            client = TestClient(app)
            r = client.get("/api/auth/me", headers={"X-Session-Id": sid})
            assert r.status_code == 200
            assert r.json()["user"]["is_admin"] is True
