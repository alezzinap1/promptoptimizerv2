"""Eval-Stability API: GET/DELETE/cancel/list and SSE stream.

These endpoints don't actually invoke the LLM — they read DB state and (for the
SSE) replay events from the in-memory bus. Tests therefore seed runs via the
DB manager and pump synthetic events into ``BUS``.
"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from db.manager import DBManager
from services.auth_service import generate_session_id, hash_password
from services.eval.event_bus import BUS


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


def _seed_run(db: DBManager, uid: int, *, status: str = "completed") -> int:
    rid = db.create_eval_run(
        user_id=uid,
        mode="single",
        prompt_a_text="P",
        prompt_a_hash="h",
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
        status=status,
    )
    if status == "completed":
        db.finalize_eval_run(
            rid,
            status="completed",
            duration_ms=1234,
            agg_overall_p50=4.0,
            agg_overall_p10=3.0,
            agg_overall_p90=5.0,
            diversity_score=0.3,
            cost_actual_usd=0.001,
            cost_actual_tokens=100,
        )
        for i in range(2):
            db.insert_eval_result(
                run_id=rid,
                prompt_side="A",
                run_index=i,
                output_text=f"out{i}",
                output_tokens=10,
                input_tokens=10,
                latency_ms=100,
                status="ok",
                judge_overall=4.0,
                judge_reasoning="ok",
            )
    return rid


def test_get_run_returns_run_results_and_judge_scores(env) -> None:
    rid = _seed_run(env["db"], env["uid"])
    r = env["client"].get(
        f"/api/eval/stability/runs/{rid}",
        headers={"X-Session-Id": env["sid"]},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["run"]["id"] == rid
    assert data["run"]["status"] == "completed"
    assert len(data["results"]) == 2
    assert data["results"][0]["judge_overall"] == 4.0


def test_get_run_404_for_other_user(env) -> None:
    db = env["db"]
    rid = _seed_run(db, env["uid"])
    other = int(db.create_user("ev2", hash_password("password12345")))
    other_sid = generate_session_id()
    db.bind_session_to_user(other_sid, other)
    r = env["client"].get(
        f"/api/eval/stability/runs/{rid}",
        headers={"X-Session-Id": other_sid},
    )
    assert r.status_code == 404


def test_list_runs_returns_user_runs_only(env) -> None:
    db = env["db"]
    a = _seed_run(db, env["uid"])
    b = _seed_run(db, env["uid"])
    other = int(db.create_user("ev2", hash_password("password12345")))
    _seed_run(db, other)
    r = env["client"].get("/api/eval/stability/runs", headers={"X-Session-Id": env["sid"]})
    assert r.status_code == 200
    ids = [it["id"] for it in r.json()["runs"]]
    assert a in ids and b in ids
    assert len(ids) == 2


def test_delete_run_removes_it(env) -> None:
    rid = _seed_run(env["db"], env["uid"])
    r = env["client"].delete(
        f"/api/eval/stability/runs/{rid}",
        headers={"X-Session-Id": env["sid"]},
    )
    assert r.status_code == 200
    assert env["db"].get_eval_run(rid, user_id=env["uid"]) is None


def test_delete_run_404_for_other_user(env) -> None:
    db = env["db"]
    rid = _seed_run(db, env["uid"])
    other = int(db.create_user("ev2", hash_password("password12345")))
    other_sid = generate_session_id()
    db.bind_session_to_user(other_sid, other)
    r = env["client"].delete(
        f"/api/eval/stability/runs/{rid}",
        headers={"X-Session-Id": other_sid},
    )
    assert r.status_code == 404


def test_cancel_run_marks_when_running(env, monkeypatch) -> None:
    rid = _seed_run(env["db"], env["uid"], status="running")
    called = {}

    def fake_cancel(run_id):
        called["rid"] = int(run_id)
        return True

    monkeypatch.setattr("backend.api.eval_stability.cancel_run", fake_cancel)
    r = env["client"].post(
        f"/api/eval/stability/runs/{rid}/cancel",
        headers={"X-Session-Id": env["sid"]},
    )
    assert r.status_code == 200, r.text
    assert called["rid"] == rid


def test_cancel_run_404_for_other_user(env) -> None:
    db = env["db"]
    rid = _seed_run(db, env["uid"], status="running")
    other = int(db.create_user("ev2", hash_password("password12345")))
    other_sid = generate_session_id()
    db.bind_session_to_user(other_sid, other)
    r = env["client"].post(
        f"/api/eval/stability/runs/{rid}/cancel",
        headers={"X-Session-Id": other_sid},
    )
    assert r.status_code == 404


def test_sse_stream_replays_history_and_terminates_on_done(env) -> None:
    rid = _seed_run(env["db"], env["uid"], status="completed")
    BUS.publish(rid, {"type": "started", "run_id": rid})
    BUS.publish(rid, {"type": "progress", "phase": "generate", "side": "A", "run_index": 0})
    BUS.publish(rid, {"type": "done", "status": "completed"})

    with env["client"].stream(
        "GET",
        f"/api/eval/stability/runs/{rid}/stream",
        headers={"X-Session-Id": env["sid"]},
    ) as resp:
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers.get("content-type", "")
        data_lines: list[str] = []
        for line in resp.iter_lines():
            if line.startswith("data:"):
                data_lines.append(line[5:].strip())
            if len(data_lines) >= 3:
                break
    types = [json.loads(d)["type"] for d in data_lines if d]
    assert "started" in types
    assert "done" in types
    BUS.clear(rid)


def test_sse_404_for_other_user(env) -> None:
    db = env["db"]
    rid = _seed_run(db, env["uid"], status="completed")
    other = int(db.create_user("ev2", hash_password("password12345")))
    other_sid = generate_session_id()
    db.bind_session_to_user(other_sid, other)
    r = env["client"].get(
        f"/api/eval/stability/runs/{rid}/stream",
        headers={"X-Session-Id": other_sid},
    )
    assert r.status_code == 404


def test_endpoints_require_session(env) -> None:
    rid = _seed_run(env["db"], env["uid"])
    c = env["client"]
    assert c.get(f"/api/eval/stability/runs/{rid}").status_code == 401
    assert c.get("/api/eval/stability/runs").status_code == 401
    assert c.delete(f"/api/eval/stability/runs/{rid}").status_code == 401
    assert c.post(f"/api/eval/stability/runs/{rid}/cancel").status_code == 401
