"""Eval-Stability API: GET /api/library/{id}/eval-summary."""
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

    return {"client": TestClient(app), "db": db, "uid": uid, "sid": sid}


def _seed_run(db: DBManager, uid: int, *, library_id: int | None) -> int:
    rid = db.create_eval_run(
        user_id=uid,
        mode="single",
        prompt_a_text="P",
        prompt_a_hash="h",
        prompt_a_library_id=library_id,
        prompt_a_library_version=1,
        task_input="T",
        target_model_id="openai/gpt-4o-mini",
        judge_model_id="openai/gpt-4o-mini",
        embedding_model_id="openai/text-embedding-3-small",
        rubric_snapshot={
            "criteria": [
                {"key": "k", "weight": 1.0, "description": "", "anchors": {"0": "x", "5": "y"}}
            ]
        },
        n_runs=2,
        cost_preview_usd=0.001,
        cost_preview_tokens=100,
        status="completed",
    )
    db.finalize_eval_run(
        rid,
        status="completed",
        agg_overall_p50=4.0,
        agg_overall_p10=3.0,
        agg_overall_p90=5.0,
        diversity_score=0.4,
        cost_actual_usd=0.001,
        cost_actual_tokens=100,
        duration_ms=200,
    )
    return rid


def test_library_eval_summary_returns_runs(env) -> None:
    db = env["db"]
    a = _seed_run(db, env["uid"], library_id=42)
    b = _seed_run(db, env["uid"], library_id=42)
    _seed_run(db, env["uid"], library_id=99)
    r = env["client"].get(
        "/api/library/42/eval-summary",
        headers={"X-Session-Id": env["sid"]},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    ids = [it["id"] for it in data["runs"]]
    assert set(ids) == {a, b}
    assert data["count"] == 2
    last = data["last"]
    assert last["agg_overall_p50"] == 4.0
    assert last["diversity_score"] == 0.4


def test_library_eval_summary_empty_when_no_runs(env) -> None:
    r = env["client"].get(
        "/api/library/42/eval-summary",
        headers={"X-Session-Id": env["sid"]},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["runs"] == []
    assert data["count"] == 0
    assert data["last"] is None


def test_library_eval_summary_isolates_by_user(env) -> None:
    db = env["db"]
    other = int(db.create_user("ev2", hash_password("password12345")))
    other_sid = generate_session_id()
    db.bind_session_to_user(other_sid, other)
    _seed_run(db, other, library_id=42)
    r = env["client"].get(
        "/api/library/42/eval-summary",
        headers={"X-Session-Id": env["sid"]},
    )
    assert r.status_code == 200
    assert r.json()["count"] == 0


def test_library_eval_summary_requires_session(env) -> None:
    r = env["client"].get("/api/library/42/eval-summary")
    assert r.status_code == 401
