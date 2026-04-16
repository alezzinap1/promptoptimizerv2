"""Migrations and helpers for admin / blocked users (phase 14)."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from db.manager import DBManager
from services.auth_service import hash_password


def test_phase14_admin_schema(tmp_path: Path) -> None:
    db_path = tmp_path / "t.db"
    db = DBManager(db_path=str(db_path))
    db.init()
    con = sqlite3.connect(str(db_path))
    con.row_factory = sqlite3.Row
    cur = con.execute("PRAGMA table_info(users)")
    cols = {row["name"] for row in cur.fetchall()}
    assert "is_admin" in cols
    assert "is_blocked" in cols
    cur = con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='admin_audit_log'"
    )
    assert cur.fetchone() is not None
    con.close()


def test_list_users_admin_and_reset_usage(tmp_path: Path) -> None:
    db_path = tmp_path / "t.db"
    db = DBManager(db_path=str(db_path))
    db.init()
    ph = hash_password("password12345")
    uid = db.create_user("alice", ph, email="alice@example.com")
    db.add_user_usage(uid, 100, 0.01)
    rows, total = db.list_users_admin(q="alice", limit=10, offset=0)
    assert total == 1
    assert rows[0]["id"] == uid
    assert rows[0]["username"] == "alice"
    assert rows[0]["email"] == "alice@example.com"
    assert "password_hash" not in rows[0]

    db.reset_user_trial_usage(uid)
    usage = db.get_user_usage(uid)
    assert usage["tokens_used"] == 0
    assert usage["dollars_used"] == 0.0

    db.set_user_blocked(uid, True)
    u = db.get_user_by_id(uid)
    assert u is not None
    assert int(u.get("is_blocked") or 0) == 1
    db.set_user_blocked(uid, False)
    u2 = db.get_user_by_id(uid)
    assert int(u2.get("is_blocked") or 0) == 0

    aid = db.log_admin_audit(uid, "test.action", uid, {"k": "v"})
    assert aid > 0
