"""End-to-end run_executor test with a mocked LLMClient."""
from __future__ import annotations

import tempfile
import time
from pathlib import Path
from unittest.mock import MagicMock

from db.manager import DBManager
from services.auth_service import hash_password
from services.eval.event_bus import BUS
from services.eval.run_executor import EXECUTOR_REGISTRY, cancel_run, start_eval_run


class _FakeEmb:
    def __init__(self, vec: list[float]) -> None:
        self.embedding = vec


def _make_client(generation_text: str = "OUTPUT") -> MagicMock:
    c = MagicMock()
    c.generate.side_effect = lambda **kw: f"{generation_text} for {kw.get('user_content', '')[:20]}"
    c.generate_json.return_value = {
        "scores": {
            "accuracy": {"score": 4, "reasoning": "ok"},
            "completeness": {"score": 5, "reasoning": "good"},
            "clarity": {"score": 4, "reasoning": "fine"},
            "instruction_following": {"score": 4, "reasoning": "ok"},
            "conciseness": {"score": 4, "reasoning": "ok"},
        },
        "overall": 4.2,
        "reasoning": "solid",
    }
    c.embed.side_effect = lambda texts, provider: [[1.0, 0.0] for _ in texts]
    return c


def _seed_run(db: DBManager, uid: int, *, mode: str = "single", n_runs: int = 3) -> int:
    return db.create_eval_run(
        user_id=uid,
        mode=mode,
        prompt_a_text="You are a haiku poet.",
        prompt_a_hash="hA",
        prompt_b_text="You are a sonnet writer." if mode == "pair" else None,
        prompt_b_hash="hB" if mode == "pair" else None,
        task_input="Write about ocean.",
        target_model_id="deepseek/deepseek-v4-flash",
        judge_model_id="openai/gpt-4o-mini",
        embedding_model_id="openai/text-embedding-3-small",
        rubric_snapshot={
            "criteria": [
                {
                    "key": "accuracy",
                    "weight": 1.0,
                    "description": "ok",
                    "anchors": {"0": "x", "5": "y"},
                },
                {
                    "key": "clarity",
                    "weight": 0.5,
                    "description": "ok",
                    "anchors": {"0": "x", "5": "y"},
                },
            ]
        },
        n_runs=n_runs,
        parallelism=2,
        cost_preview_usd=0.01,
        cost_preview_tokens=500,
        pair_judge_samples=3 if mode == "pair" else 0,
    )


def test_run_executor_completes_single_mode() -> None:
    tmp = tempfile.mkdtemp()
    db = DBManager(str(Path(tmp) / "x.db"))
    db.init()
    uid = int(db.create_user("u", hash_password("password12345")))
    run_id = _seed_run(db, uid, mode="single", n_runs=3)

    q = BUS.subscribe(run_id)
    fut = start_eval_run(db, _make_client(), run_id)
    fut.result(timeout=15)

    run = db.get_eval_run(run_id, uid)
    assert run["status"] == "completed"
    assert run["agg_overall_p50"] is not None
    assert run["duration_ms"] is not None
    assert run["finished_at"] is not None
    # Diversity = 0 because all embeddings identical
    assert run["diversity_score"] == 0.0

    rows = db.list_eval_results_for_run(run_id)
    assert len(rows) == 3
    for r in rows:
        assert r["status"] == "ok"
        assert r["judge_overall"] is not None
        assert r["embedding"] == [1.0, 0.0]

    types_seen = []
    while not q.empty():
        types_seen.append(q.get_nowait()["type"])
    assert "started" in types_seen
    assert "done" in types_seen
    assert any(t == "progress" for t in types_seen)


def test_run_executor_pair_mode_produces_winner() -> None:
    tmp = tempfile.mkdtemp()
    db = DBManager(str(Path(tmp) / "x.db"))
    db.init()
    uid = int(db.create_user("u2", hash_password("password12345")))
    run_id = _seed_run(db, uid, mode="pair", n_runs=2)

    client = _make_client()
    # Pair-judge: prefer A every time
    client.generate_json.side_effect = None
    pair_response = {"winner": "A", "confidence": 0.8, "reasoning": "A wins"}
    single_response = {
        "scores": {
            "accuracy": {"score": 4, "reasoning": "ok"},
            "clarity": {"score": 4, "reasoning": "fine"},
        },
        "overall": 4.0,
        "reasoning": "ok",
    }

    def _gen_json(**kwargs):
        sp = kwargs.get("system_prompt", "")
        return pair_response if "winner" in sp.lower() else single_response

    client.generate_json.side_effect = _gen_json

    fut = start_eval_run(db, client, run_id)
    fut.result(timeout=15)

    run = db.get_eval_run(run_id, uid)
    assert run["status"] == "completed"
    assert run["pair_winner"] == "A"
    assert run["pair_winner_confidence"] is not None

    rows = db.list_eval_results_for_run(run_id)
    sides = {r["prompt_side"] for r in rows}
    assert sides == {"A", "B"}
    assert len(rows) == 4  # 2 runs × 2 sides


def test_run_executor_handles_generation_error() -> None:
    tmp = tempfile.mkdtemp()
    db = DBManager(str(Path(tmp) / "x.db"))
    db.init()
    uid = int(db.create_user("u3", hash_password("password12345")))
    run_id = _seed_run(db, uid, mode="single", n_runs=2)

    client = _make_client()

    call_state = {"i": 0}

    def _gen(**kw):
        call_state["i"] += 1
        if call_state["i"] == 1:
            raise RuntimeError("boom")
        return "OK"

    client.generate.side_effect = _gen

    fut = start_eval_run(db, client, run_id)
    fut.result(timeout=15)

    run = db.get_eval_run(run_id, uid)
    assert run["status"] == "completed"
    rows = db.list_eval_results_for_run(run_id)
    statuses = {r["status"] for r in rows}
    assert "error" in statuses or "ok" in statuses
    # At least one error row recorded
    assert any(r["status"] == "error" for r in rows)


def test_cancel_run_marks_cancelled() -> None:
    tmp = tempfile.mkdtemp()
    db = DBManager(str(Path(tmp) / "x.db"))
    db.init()
    uid = int(db.create_user("u4", hash_password("password12345")))
    run_id = _seed_run(db, uid, mode="single", n_runs=10)

    client = _make_client()

    def _slow_gen(**kw):
        time.sleep(0.05)
        return "ok"

    client.generate.side_effect = _slow_gen

    fut = start_eval_run(db, client, run_id)
    time.sleep(0.05)  # let it start
    assert cancel_run(run_id) is True
    fut.result(timeout=15)

    run = db.get_eval_run(run_id, uid)
    assert run["status"] in {"cancelled", "completed"}
    # Registry cleared
    assert run_id not in EXECUTOR_REGISTRY
