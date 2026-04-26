"""Verify that running eval runs are marked failed when the server starts.

A crash mid-run leaves rows in 'running' forever — the startup hook calls
``DBManager.mark_running_runs_failed()`` to make those visible as failed
rather than perpetually pending in the UI.
"""
from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from db.manager import DBManager
from services.auth_service import hash_password


def test_startup_recovery_marks_running_runs_as_failed() -> None:
    tmp = tempfile.mkdtemp()
    db_path = str(Path(tmp) / "x.db")
    db = DBManager(db_path)
    db.init()
    uid = int(db.create_user("u", hash_password("password12345")))

    # Seed a stuck "running" run
    rid = db.create_eval_run(
        user_id=uid,
        mode="single",
        prompt_a_text="P",
        prompt_a_hash="h",
        task_input="T",
        target_model_id="openai/gpt-4o-mini",
        judge_model_id="openai/gpt-4o-mini",
        embedding_model_id="openai/text-embedding-3-small",
        rubric_snapshot={"criteria": [{"key": "k", "weight": 1.0, "description": "", "anchors": {"0": "x", "5": "y"}}]},
        n_runs=1,
        cost_preview_usd=0.001,
        cost_preview_tokens=100,
        status="running",
    )

    with patch("config.settings.DB_PATH", db_path):
        from backend.main import app

        with TestClient(app):  # entering context triggers startup
            pass

    db2 = DBManager(db_path)
    run = db2.get_eval_run(rid, user_id=uid)
    assert run is not None
    assert run["status"] == "failed"
    assert run["error"] is not None
