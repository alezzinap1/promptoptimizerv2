"""Settings API: eval_daily_budget_usd round-trip."""
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from db.manager import DBManager
from services.auth_service import generate_session_id, hash_password


@pytest.fixture
def env(monkeypatch):
    tmp = tempfile.mkdtemp()
    db_path = str(Path(tmp) / "x.db")
    db = DBManager(db_path)
    db.init()
    uid = int(db.create_user("u", hash_password("password12345")))
    sid = generate_session_id()
    db.bind_session_to_user(sid, uid)
    monkeypatch.setattr("backend.deps.DB_PATH", db_path)
    from backend.main import app

    return {"client": TestClient(app), "sid": sid, "uid": uid, "db": db}


def test_get_settings_includes_default_budget(env) -> None:
    r = env["client"].get("/api/settings", headers={"X-Session-Id": env["sid"]})
    assert r.status_code == 200
    data = r.json()
    assert "eval_daily_budget_usd" in data
    assert data["eval_daily_budget_usd"] == 5.0


def test_patch_budget_updates_value(env) -> None:
    r = env["client"].patch(
        "/api/settings",
        headers={"X-Session-Id": env["sid"]},
        json={"eval_daily_budget_usd": 1.25},
    )
    assert r.status_code == 200, r.text
    assert r.json()["eval_daily_budget_usd"] == 1.25
    assert env["db"].get_user_eval_budget(env["uid"]) == 1.25


def test_patch_rejects_huge_budget(env) -> None:
    r = env["client"].patch(
        "/api/settings",
        headers={"X-Session-Id": env["sid"]},
        json={"eval_daily_budget_usd": 9999.0},
    )
    assert r.status_code == 422


def test_patch_rejects_negative_budget(env) -> None:
    r = env["client"].patch(
        "/api/settings",
        headers={"X-Session-Id": env["sid"]},
        json={"eval_daily_budget_usd": -1.0},
    )
    assert r.status_code == 422
