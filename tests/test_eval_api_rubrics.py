"""Eval-Stability API: rubric CRUD."""
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from db.manager import DBManager
from services.auth_service import generate_session_id, hash_password


@pytest.fixture
def env(monkeypatch):
    """Tempdir + DBManager + a valid session, with backend.deps.DB_PATH patched."""
    tmp = tempfile.mkdtemp()
    db_path = str(Path(tmp) / "x.db")
    db = DBManager(db_path)
    db.init()
    uid = int(db.create_user("u", hash_password("password12345")))
    sid = generate_session_id()
    db.bind_session_to_user(sid, uid)
    monkeypatch.setattr("backend.deps.DB_PATH", db_path)
    from backend.main import app

    client = TestClient(app)
    return {"db": db, "db_path": db_path, "uid": uid, "sid": sid, "client": client}


def test_list_rubrics_returns_presets_and_empty_custom(env) -> None:
    r = env["client"].get("/api/eval/rubrics", headers={"X-Session-Id": env["sid"]})
    assert r.status_code == 200, r.text
    data = r.json()
    assert "presets" in data and "custom" in data
    assert any(p["preset_key"] == "default_g_eval" for p in data["presets"])
    assert data["custom"] == []


def test_create_rubric_then_list_includes_it(env) -> None:
    c = env["client"]
    sid = env["sid"]
    r = c.post(
        "/api/eval/rubrics",
        headers={"X-Session-Id": sid},
        json={
            "name": "My rubric",
            "criteria": [
                {
                    "key": "accuracy",
                    "weight": 1.0,
                    "description": "ok",
                    "anchors": {"0": "x", "5": "y"},
                }
            ],
            "reference_required": False,
        },
    )
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    r2 = c.get("/api/eval/rubrics", headers={"X-Session-Id": sid})
    custom_ids = [it["id"] for it in r2.json()["custom"]]
    assert rid in custom_ids


def test_update_and_delete_rubric(env) -> None:
    c = env["client"]
    sid = env["sid"]
    rid = c.post(
        "/api/eval/rubrics",
        headers={"X-Session-Id": sid},
        json={
            "name": "X",
            "criteria": [
                {"key": "k", "weight": 1.0, "description": "", "anchors": {"0": "a", "5": "b"}}
            ],
        },
    ).json()["id"]
    r = c.patch(
        f"/api/eval/rubrics/{rid}",
        headers={"X-Session-Id": sid},
        json={"name": "Y"},
    )
    assert r.status_code == 200
    items = c.get("/api/eval/rubrics", headers={"X-Session-Id": sid}).json()["custom"]
    assert items[0]["name"] == "Y"
    rd = c.delete(f"/api/eval/rubrics/{rid}", headers={"X-Session-Id": sid})
    assert rd.status_code == 200
    items = c.get("/api/eval/rubrics", headers={"X-Session-Id": sid}).json()["custom"]
    assert items == []


def test_user_cannot_modify_other_users_rubric(env) -> None:
    db = env["db"]
    c = env["client"]
    sid = env["sid"]
    other_uid = int(db.create_user("ev2", hash_password("password12345")))
    other_sid = generate_session_id()
    db.bind_session_to_user(other_sid, other_uid)

    rid = c.post(
        "/api/eval/rubrics",
        headers={"X-Session-Id": sid},
        json={
            "name": "owner",
            "criteria": [
                {"key": "k", "weight": 1.0, "description": "", "anchors": {"0": "a", "5": "b"}}
            ],
        },
    ).json()["id"]

    r = c.patch(
        f"/api/eval/rubrics/{rid}",
        headers={"X-Session-Id": other_sid},
        json={"name": "hacked"},
    )
    assert r.status_code == 404
    r = c.delete(f"/api/eval/rubrics/{rid}", headers={"X-Session-Id": other_sid})
    assert r.status_code == 404


def test_create_rubric_requires_session(env) -> None:
    r = env["client"].post(
        "/api/eval/rubrics",
        json={
            "name": "X",
            "criteria": [
                {"key": "k", "weight": 1.0, "description": "", "anchors": {"0": "a", "5": "b"}}
            ],
        },
    )
    assert r.status_code == 401
