"""Migrations and CRUD for eval-stability tables (phase20)."""
from __future__ import annotations

import tempfile
from pathlib import Path

from db.manager import DBManager


def _fresh_db() -> tuple[DBManager, str]:
    tmp = tempfile.mkdtemp()
    db_path = str(Path(tmp) / "eval.db")
    db = DBManager(db_path)
    db.init()
    return db, db_path


def _table_exists(db: DBManager, name: str) -> bool:
    with db._conn() as conn:  # noqa: SLF001
        row = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            (name,),
        ).fetchone()
    return row is not None


def _columns(db: DBManager, table: str) -> set[str]:
    with db._conn() as conn:  # noqa: SLF001
        rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return {r["name"] for r in rows}


def test_phase20_creates_eval_tables() -> None:
    db, _ = _fresh_db()
    for name in (
        "eval_rubrics",
        "eval_runs",
        "eval_results",
        "eval_judge_scores",
        "eval_user_daily_usage",
    ):
        assert _table_exists(db, name), f"expected table {name} to exist after init()"


def test_phase20_users_has_eval_daily_budget_usd() -> None:
    db, _ = _fresh_db()
    cols = _columns(db, "users")
    assert "eval_daily_budget_usd" in cols


def test_phase20_eval_runs_has_required_columns() -> None:
    db, _ = _fresh_db()
    cols = _columns(db, "eval_runs")
    required = {
        "id",
        "user_id",
        "status",
        "mode",
        "prompt_a_text",
        "prompt_a_hash",
        "prompt_b_text",
        "task_input",
        "reference_answer",
        "target_model_id",
        "judge_model_id",
        "embedding_model_id",
        "rubric_id",
        "rubric_snapshot_json",
        "n_runs",
        "parallelism",
        "temperature",
        "top_p",
        "pair_judge_samples",
        "cost_preview_usd",
        "cost_preview_tokens",
        "cost_actual_usd",
        "cost_actual_tokens",
        "duration_ms",
        "diversity_score",
        "agg_overall_p50",
        "agg_overall_p10",
        "agg_overall_p90",
        "agg_overall_var",
        "pair_winner",
        "pair_winner_confidence",
        "error",
        "created_at",
        "finished_at",
    }
    missing = required - cols
    assert not missing, f"eval_runs is missing columns: {missing}"


def test_phase20_eval_results_has_required_columns() -> None:
    db, _ = _fresh_db()
    cols = _columns(db, "eval_results")
    required = {
        "id",
        "run_id",
        "prompt_side",
        "run_index",
        "output_text",
        "output_tokens",
        "input_tokens",
        "latency_ms",
        "status",
        "error",
        "embedding_blob",
        "judge_overall",
        "judge_overall_secondary",
        "judge_reasoning",
        "parsed_as_json",
        "parsed_top_fields_json",
        "created_at",
    }
    missing = required - cols
    assert not missing, f"eval_results is missing columns: {missing}"


def test_phase20_re_init_is_idempotent() -> None:
    """Calling init() twice on the same db must not raise."""
    db, path = _fresh_db()
    db2 = DBManager(path)
    db2.init()
    assert _table_exists(db2, "eval_runs")
