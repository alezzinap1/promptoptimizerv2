"""Eval-Stability API: /eval/stability/preview-cost."""
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

    return {"client": TestClient(app), "sid": sid, "db": db, "uid": uid}


def _payload(**overrides):
    base = {
        "prompt_a_text": "Translate the user input to French.",
        "task_input": "Hello world",
        "n_runs": 10,
        "target_model_id": "openai/gpt-4o-mini",
        "judge_model_id": "openai/gpt-4o-mini",
        "embedding_model_id": "openai/text-embedding-3-small",
        "expected_output_tokens": 600,
    }
    base.update(overrides)
    return base


def test_preview_cost_single_returns_breakdown(env) -> None:
    r = env["client"].post(
        "/api/eval/stability/preview-cost",
        headers={"X-Session-Id": env["sid"]},
        json=_payload(),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    for key in ("target", "judge", "embedding", "total_tokens", "total_usd", "pricing_status"):
        assert key in data
    assert data["total_usd"] > 0
    assert data["pricing_status"] == "exact"
    assert data["over_daily_budget"] is False
    assert "daily_remaining_usd" in data


def test_preview_cost_pair_doubles_target_calls(env) -> None:
    single = env["client"].post(
        "/api/eval/stability/preview-cost",
        headers={"X-Session-Id": env["sid"]},
        json=_payload(),
    ).json()
    pair = env["client"].post(
        "/api/eval/stability/preview-cost",
        headers={"X-Session-Id": env["sid"]},
        json=_payload(prompt_b_text="Translate to Spanish.", pair_judge_samples=5),
    ).json()
    assert pair["target"]["output_tokens"] >= 2 * single["target"]["output_tokens"] - 1
    assert pair["total_usd"] > single["total_usd"]


def test_preview_cost_rejects_non_whitelisted_judge(env) -> None:
    r = env["client"].post(
        "/api/eval/stability/preview-cost",
        headers={"X-Session-Id": env["sid"]},
        json=_payload(judge_model_id="openai/gpt-4o"),
    )
    assert r.status_code == 400
    assert "judge" in r.text.lower() or "whitelist" in r.text.lower()


def test_preview_cost_rejects_non_whitelisted_embedding(env) -> None:
    r = env["client"].post(
        "/api/eval/stability/preview-cost",
        headers={"X-Session-Id": env["sid"]},
        json=_payload(embedding_model_id="openai/text-embedding-ada-002"),
    )
    assert r.status_code == 400


def test_preview_cost_rejects_huge_n_runs(env) -> None:
    r = env["client"].post(
        "/api/eval/stability/preview-cost",
        headers={"X-Session-Id": env["sid"]},
        json=_payload(n_runs=500),
    )
    assert r.status_code == 422


def test_preview_cost_requires_session(env) -> None:
    r = env["client"].post("/api/eval/stability/preview-cost", json=_payload())
    assert r.status_code == 401


def test_preview_cost_flags_over_budget_when_remaining_is_low(env) -> None:
    db = env["db"]
    uid = env["uid"]
    # Drop budget to 0.001 USD so any real run is over.
    db.update_user_eval_budget(uid, 0.001)
    r = env["client"].post(
        "/api/eval/stability/preview-cost",
        headers={"X-Session-Id": env["sid"]},
        json=_payload(),
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["over_daily_budget"] is True
