"""Lineage fingerprints, excerpt verification, and run series query."""
from __future__ import annotations

import tempfile
from pathlib import Path

from db.manager import DBManager
from services.auth_service import hash_password
from services.eval.lineage import fingerprints_for_stored_run, task_fingerprint
from services.eval.meta_pipeline import verify_quote_in_output


def test_task_fingerprint_includes_reference() -> None:
    a = task_fingerprint("same task", None)
    b = task_fingerprint("same task", "ref1")
    c = task_fingerprint("same task", "ref1")
    assert a != b
    assert b == c


def test_verify_quote_normalizes_whitespace() -> None:
    out = "Hello   world\nfoo"
    assert verify_quote_in_output(out, "Hello world foo")


def test_list_series_requires_matching_lineage() -> None:
    tmp = tempfile.mkdtemp()
    db = DBManager(str(Path(tmp) / "s.db"))
    db.init()
    uid = int(db.create_user("u", hash_password("password12345")))
    snap = {"preset_key": "p", "criteria": [{"key": "k", "weight": 1.0}]}
    pfp, tfp, rfp = fingerprints_for_stored_run(
        {
            "prompt_a_text": "P1",
            "prompt_b_text": None,
            "task_input": "T1",
            "reference_answer": None,
            "rubric_snapshot": snap,
        }
    )
    rid1 = db.create_eval_run(
        user_id=uid,
        mode="single",
        prompt_a_text="P1",
        prompt_a_hash="x",
        task_input="T1",
        target_model_id="m1",
        judge_model_id="j",
        embedding_model_id="e",
        rubric_snapshot=snap,
        n_runs=1,
        cost_preview_usd=0.01,
        cost_preview_tokens=1,
        status="completed",
        prompt_fingerprint=pfp,
        task_fingerprint=tfp,
        rubric_fingerprint=rfp,
    )
    rid2 = db.create_eval_run(
        user_id=uid,
        mode="single",
        prompt_a_text="P1",
        prompt_a_hash="x",
        task_input="T1",
        target_model_id="m2",
        judge_model_id="j",
        embedding_model_id="e",
        rubric_snapshot=snap,
        n_runs=1,
        cost_preview_usd=0.01,
        cost_preview_tokens=1,
        status="completed",
        prompt_fingerprint=pfp,
        task_fingerprint=tfp,
        rubric_fingerprint=rfp,
    )
    series_all = db.list_eval_runs_series(
        uid, prompt_fingerprint=pfp, task_fingerprint=tfp, rubric_fingerprint=rfp, limit=20
    )
    assert len(series_all) == 2
    series_m1 = db.list_eval_runs_series(
        uid,
        prompt_fingerprint=pfp,
        task_fingerprint=tfp,
        rubric_fingerprint=rfp,
        target_model_id="m1",
        limit=20,
    )
    assert len(series_m1) == 1
    assert series_m1[0]["id"] == rid1

    other_tfp = task_fingerprint("OTHER", None)
    assert (
        db.list_eval_runs_series(
            uid, prompt_fingerprint=pfp, task_fingerprint=other_tfp, rubric_fingerprint=rfp, limit=20
        )
        == []
    )
