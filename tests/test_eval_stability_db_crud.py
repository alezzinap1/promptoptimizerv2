"""CRUD methods for eval-stability tables on DBManager."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

from db.manager import DBManager
from services.auth_service import hash_password


def _fresh_db() -> tuple[DBManager, int]:
    tmp = tempfile.mkdtemp()
    db = DBManager(str(Path(tmp) / "eval.db"))
    db.init()
    uid = db.create_user("evaluser", hash_password("password12345"))
    return db, int(uid)


def _make_run_kwargs(user_id: int, **overrides) -> dict:
    base = dict(
        user_id=user_id,
        mode="single",
        prompt_a_text="Write a haiku about {topic}",
        prompt_a_hash="hash-a",
        prompt_a_library_id=None,
        prompt_a_library_version=None,
        prompt_b_text=None,
        prompt_b_hash=None,
        prompt_b_library_id=None,
        prompt_b_library_version=None,
        task_input="topic=ocean",
        reference_answer=None,
        target_model_id="deepseek/deepseek-v4-flash",
        judge_model_id="openai/gpt-4o-mini",
        embedding_model_id="openai/text-embedding-3-small",
        rubric_id=None,
        rubric_snapshot={"criteria": [{"key": "accuracy", "weight": 1.0}]},
        n_runs=5,
        parallelism=4,
        temperature=0.7,
        top_p=None,
        pair_judge_samples=5,
        cost_preview_usd=0.05,
        cost_preview_tokens=1234,
    )
    base.update(overrides)
    return base


# ── Rubrics ────────────────────────────────────────────────────────────────


def test_create_and_list_eval_rubric() -> None:
    db, uid = _fresh_db()
    rid = db.create_eval_rubric(
        user_id=uid,
        name="Default G-Eval",
        criteria=[{"key": "accuracy", "weight": 1.0, "anchors": {"0": "wrong", "5": "perfect"}}],
        preset_key="default",
        reference_required=False,
    )
    assert rid > 0
    items = db.list_eval_rubrics(uid)
    assert len(items) == 1
    assert items[0]["name"] == "Default G-Eval"
    assert items[0]["criteria"][0]["key"] == "accuracy"
    assert items[0]["reference_required"] is False


def test_get_eval_rubric_isolated_by_user() -> None:
    db, uid = _fresh_db()
    other = db.create_user("other", hash_password("password12345"))
    rid = db.create_eval_rubric(uid, "X", [{"key": "k", "weight": 1.0}])
    assert db.get_eval_rubric(rid, user_id=uid) is not None
    assert db.get_eval_rubric(rid, user_id=int(other)) is None
    assert db.get_eval_rubric(rid, user_id=None) is not None


def test_update_and_delete_eval_rubric() -> None:
    db, uid = _fresh_db()
    rid = db.create_eval_rubric(uid, "Old", [{"key": "k", "weight": 1.0}])
    assert db.update_eval_rubric(rid, uid, name="New", criteria=[{"key": "k", "weight": 0.5}])
    got = db.get_eval_rubric(rid, uid)
    assert got and got["name"] == "New"
    assert got["criteria"][0]["weight"] == 0.5
    assert db.delete_eval_rubric(rid, uid)
    assert db.get_eval_rubric(rid, uid) is None


# ── Runs ───────────────────────────────────────────────────────────────────


def test_create_and_get_eval_run() -> None:
    db, uid = _fresh_db()
    rid = db.create_eval_run(**_make_run_kwargs(uid))
    assert rid > 0
    run = db.get_eval_run(rid, user_id=uid)
    assert run is not None
    assert run["status"] == "queued"
    assert run["mode"] == "single"
    assert run["n_runs"] == 5
    assert run["rubric_snapshot"]["criteria"][0]["key"] == "accuracy"


def test_get_eval_run_user_isolation_and_internal() -> None:
    db, uid = _fresh_db()
    other = db.create_user("other", hash_password("password12345"))
    rid = db.create_eval_run(**_make_run_kwargs(uid))
    assert db.get_eval_run(rid, user_id=int(other)) is None
    assert db.get_eval_run(rid, user_id=None) is not None


def test_update_eval_run_status_and_finalize() -> None:
    db, uid = _fresh_db()
    rid = db.create_eval_run(**_make_run_kwargs(uid))
    db.update_eval_run_status(rid, status="running")
    assert db.get_eval_run(rid, uid)["status"] == "running"

    db.finalize_eval_run(
        rid,
        status="completed",
        cost_actual_usd=0.04,
        cost_actual_tokens=1100,
        duration_ms=2345,
        diversity_score=0.82,
        agg_overall_p50=4.2,
        agg_overall_p10=3.5,
        agg_overall_p90=4.8,
        agg_overall_var=0.21,
        pair_winner=None,
        pair_winner_confidence=None,
    )
    final = db.get_eval_run(rid, uid)
    assert final["status"] == "completed"
    assert final["cost_actual_usd"] == 0.04
    assert final["diversity_score"] == 0.82
    assert final["finished_at"] is not None


def test_list_eval_runs_for_user_and_library() -> None:
    db, uid = _fresh_db()
    db.create_eval_run(**_make_run_kwargs(uid))
    db.create_eval_run(**_make_run_kwargs(uid, prompt_a_library_id=42, prompt_a_library_version=1))
    own = db.list_eval_runs_for_user(uid)
    assert len(own) == 2
    by_lib = db.list_eval_runs_for_library(42)
    assert len(by_lib) == 1
    assert by_lib[0]["prompt_a_library_id"] == 42


def test_mark_running_runs_failed() -> None:
    db, uid = _fresh_db()
    rid_q = db.create_eval_run(**_make_run_kwargs(uid))
    rid_r = db.create_eval_run(**_make_run_kwargs(uid))
    db.update_eval_run_status(rid_r, status="running")

    fixed = db.mark_running_runs_failed(reason="server restart")
    assert fixed == 1
    assert db.get_eval_run(rid_r, uid)["status"] == "failed"
    assert db.get_eval_run(rid_r, uid)["error"] == "server restart"
    # queued runs are left alone
    assert db.get_eval_run(rid_q, uid)["status"] == "queued"


# ── Results & judge scores ────────────────────────────────────────────────


def test_insert_and_list_eval_results() -> None:
    db, uid = _fresh_db()
    rid = db.create_eval_run(**_make_run_kwargs(uid))
    res_id = db.insert_eval_result(
        run_id=rid,
        prompt_side="A",
        run_index=0,
        output_text="hello",
        output_tokens=10,
        input_tokens=20,
        latency_ms=300,
        status="ok",
        embedding=[0.1, 0.2, 0.3],
        judge_overall=4.0,
        judge_reasoning="good",
        parsed_as_json=False,
    )
    assert res_id > 0
    items = db.list_eval_results_for_run(rid)
    assert len(items) == 1
    assert items[0]["output_text"] == "hello"
    assert items[0]["embedding"] == [0.1, 0.2, 0.3]
    assert items[0]["judge_overall"] == 4.0


def test_judge_scores_persistence() -> None:
    db, uid = _fresh_db()
    rid = db.create_eval_run(**_make_run_kwargs(uid))
    res_id = db.insert_eval_result(
        run_id=rid,
        prompt_side="A",
        run_index=0,
        output_text="x",
        output_tokens=1,
        input_tokens=1,
        latency_ms=10,
        status="ok",
        embedding=None,
        judge_overall=3.0,
        judge_reasoning=None,
        parsed_as_json=False,
    )
    db.insert_judge_scores(
        res_id,
        [
            {"criterion_key": "accuracy", "score": 4.0, "reasoning": "ok"},
            {"criterion_key": "clarity", "score": 3.0, "reasoning": "fine"},
        ],
    )
    scores = db.list_judge_scores_for_result(res_id)
    assert len(scores) == 2
    keys = {s["criterion_key"] for s in scores}
    assert keys == {"accuracy", "clarity"}


# ── Daily usage ───────────────────────────────────────────────────────────


def test_eval_daily_usage_accumulates() -> None:
    db, uid = _fresh_db()
    assert db.get_eval_daily_usage(uid, "2026-04-25") == 0.0
    db.add_eval_daily_usage(uid, "2026-04-25", 0.10)
    db.add_eval_daily_usage(uid, "2026-04-25", 0.05)
    assert abs(db.get_eval_daily_usage(uid, "2026-04-25") - 0.15) < 1e-9
    assert db.get_eval_daily_usage(uid, "2026-04-26") == 0.0
