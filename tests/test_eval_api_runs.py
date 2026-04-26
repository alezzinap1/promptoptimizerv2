"""Eval-Stability API: POST /eval/stability/runs (run creation)."""
from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

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
    monkeypatch.setattr(
        "backend.api.eval_stability.resolve_openrouter_api_key",
        lambda user_key=None: "sk-or-test",
    )
    # Don't actually run the heavy background executor in API tests.
    monkeypatch.setattr(
        "backend.api.eval_stability.start_eval_run",
        lambda db, client, run_id: MagicMock(),
    )
    from backend.main import app

    return {"client": TestClient(app), "sid": sid, "db": db, "uid": uid}


def _payload(**overrides):
    base = {
        "prompt_a_text": "Translate to French.",
        "task_input": "Hello world",
        "n_runs": 3,
        "target_model_id": "openai/gpt-4o-mini",
        "judge_model_id": "openai/gpt-4o-mini",
        "embedding_model_id": "openai/text-embedding-3-small",
        "expected_output_tokens": 200,
        "preset_key": "default_g_eval",
        "temperature": 0.7,
    }
    base.update(overrides)
    return base


def test_create_run_returns_id_and_status_queued(env) -> None:
    r = env["client"].post(
        "/api/eval/stability/runs",
        headers={"X-Session-Id": env["sid"]},
        json=_payload(),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert "run_id" in data
    assert data["status"] in {"queued", "running"}
    run = env["db"].get_eval_run(int(data["run_id"]), user_id=env["uid"])
    assert run is not None
    assert run["mode"] == "single"
    assert run["target_model_id"] == "openai/gpt-4o-mini"
    snap = run["rubric_snapshot"]
    assert snap.get("criteria")


def test_create_pair_run_when_prompt_b_provided(env) -> None:
    r = env["client"].post(
        "/api/eval/stability/runs",
        headers={"X-Session-Id": env["sid"]},
        json=_payload(prompt_b_text="Translate to Spanish.", pair_judge_samples=3),
    )
    assert r.status_code == 200
    run = env["db"].get_eval_run(int(r.json()["run_id"]), user_id=env["uid"])
    assert run["mode"] == "pair"
    assert run["pair_judge_samples"] == 3


def test_create_run_persists_meta_synthesis_mode_lite(env) -> None:
    r = env["client"].post(
        "/api/eval/stability/runs",
        headers={"X-Session-Id": env["sid"]},
        json=_payload(meta_synthesis_mode="lite"),
    )
    assert r.status_code == 200, r.text
    run = env["db"].get_eval_run(int(r.json()["run_id"]), user_id=env["uid"])
    assert run["meta_synthesis_mode"] == "lite"


def test_create_run_with_custom_rubric_id(env) -> None:
    rid = env["db"].create_eval_rubric(
        user_id=env["uid"],
        name="custom",
        criteria=[
            {"key": "a", "weight": 1.0, "description": "", "anchors": {"0": "x", "5": "y"}}
        ],
    )
    r = env["client"].post(
        "/api/eval/stability/runs",
        headers={"X-Session-Id": env["sid"]},
        json=_payload(preset_key=None, rubric_id=rid),
    )
    assert r.status_code == 200, r.text
    run = env["db"].get_eval_run(int(r.json()["run_id"]), user_id=env["uid"])
    assert run["rubric_id"] == rid
    assert run["rubric_snapshot"]["criteria"][0]["key"] == "a"


def test_create_run_rejects_unknown_rubric_id(env) -> None:
    r = env["client"].post(
        "/api/eval/stability/runs",
        headers={"X-Session-Id": env["sid"]},
        json=_payload(preset_key=None, rubric_id=99999),
    )
    assert r.status_code == 404


def test_create_run_rejects_no_rubric(env) -> None:
    r = env["client"].post(
        "/api/eval/stability/runs",
        headers={"X-Session-Id": env["sid"]},
        json=_payload(preset_key=None),
    )
    assert r.status_code == 400


def test_create_run_rejects_non_whitelisted_judge(env) -> None:
    r = env["client"].post(
        "/api/eval/stability/runs",
        headers={"X-Session-Id": env["sid"]},
        json=_payload(judge_model_id="openai/gpt-4o"),
    )
    assert r.status_code == 400


def test_create_run_blocked_when_over_daily_budget(env) -> None:
    env["db"].update_user_eval_budget(env["uid"], 0.0001)
    r = env["client"].post(
        "/api/eval/stability/runs",
        headers={"X-Session-Id": env["sid"]},
        json=_payload(),
    )
    assert r.status_code == 402


def test_create_run_requires_session(env) -> None:
    r = env["client"].post("/api/eval/stability/runs", json=_payload())
    assert r.status_code == 401


def test_create_run_without_api_key_returns_500(env, monkeypatch) -> None:
    monkeypatch.setattr(
        "backend.api.eval_stability.resolve_openrouter_api_key",
        lambda user_key=None: "",
    )
    r = env["client"].post(
        "/api/eval/stability/runs",
        headers={"X-Session-Id": env["sid"]},
        json=_payload(),
    )
    assert r.status_code in {500, 400}
