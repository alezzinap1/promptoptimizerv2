"""Cost estimation for stability evaluation runs."""
from __future__ import annotations

from services.eval.cost_estimator import estimate_run_cost


def test_single_run_basic_breakdown() -> None:
    out = estimate_run_cost(
        prompt_a_text="You are a helpful assistant.",
        task_input="What is 2+2?",
        n_runs=10,
        target_model_id="deepseek/deepseek-v4-flash",
        judge_model_id="openai/gpt-4o-mini",
        embedding_model_id="openai/text-embedding-3-small",
        expected_output_tokens=200,
    )
    for key in ("target", "judge", "synthesis", "embedding", "total_tokens", "total_usd", "pricing_status"):
        assert key in out
    for sub in ("target", "judge"):
        assert {"input_tokens", "output_tokens", "usd"} <= set(out[sub].keys())
    assert {"input_tokens", "usd"} <= set(out["embedding"].keys())
    assert out["total_usd"] > 0
    assert out["total_tokens"] > 0


def test_pair_costs_more_than_single() -> None:
    base = dict(
        prompt_a_text="A " * 50,
        task_input="task " * 20,
        n_runs=5,
        target_model_id="deepseek/deepseek-v4-flash",
        judge_model_id="openai/gpt-4o-mini",
        embedding_model_id="openai/text-embedding-3-small",
        expected_output_tokens=300,
    )
    single = estimate_run_cost(**base)
    pair = estimate_run_cost(**base, prompt_b_text="B " * 50, pair_judge_samples=5)
    assert pair["total_usd"] > single["total_usd"]
    assert pair["total_tokens"] > single["total_tokens"]


def test_more_n_runs_costs_more() -> None:
    base = dict(
        prompt_a_text="A",
        task_input="t",
        target_model_id="deepseek/deepseek-v4-flash",
        judge_model_id="openai/gpt-4o-mini",
        embedding_model_id="openai/text-embedding-3-small",
        expected_output_tokens=100,
        run_synthesis=False,
    )
    five = estimate_run_cost(n_runs=5, **base)
    twenty = estimate_run_cost(n_runs=20, **base)
    # 4× runs should give ≈4× total cost (within rounding).
    ratio = twenty["total_usd"] / max(five["total_usd"], 1e-9)
    assert 3.5 < ratio < 4.5


def test_unknown_model_marked_approximate() -> None:
    out = estimate_run_cost(
        prompt_a_text="x",
        task_input="y",
        n_runs=1,
        target_model_id="some-unknown-vendor/some-model",
        judge_model_id="openai/gpt-4o-mini",
        embedding_model_id="openai/text-embedding-3-small",
        expected_output_tokens=50,
    )
    assert out["pricing_status"] == "approximate"
    assert out["total_usd"] > 0


def test_known_models_exact() -> None:
    out = estimate_run_cost(
        prompt_a_text="x",
        task_input="y",
        n_runs=1,
        target_model_id="deepseek/deepseek-v4-flash",
        judge_model_id="openai/gpt-4o-mini",
        embedding_model_id="openai/text-embedding-3-small",
        expected_output_tokens=50,
    )
    assert out["pricing_status"] == "exact"


def test_reference_answer_increases_judge_input() -> None:
    base = dict(
        prompt_a_text="A",
        task_input="t",
        n_runs=5,
        target_model_id="deepseek/deepseek-v4-flash",
        judge_model_id="openai/gpt-4o-mini",
        embedding_model_id="openai/text-embedding-3-small",
        expected_output_tokens=100,
    )
    no_ref = estimate_run_cost(**base)
    with_ref = estimate_run_cost(**base, reference_answer="A long reference answer " * 50)
    assert with_ref["judge"]["input_tokens"] > no_ref["judge"]["input_tokens"]
    assert with_ref["total_usd"] > no_ref["total_usd"]


def test_alias_remap_uses_known_pricing() -> None:
    """Deprecated DeepSeek slug should map to V4 Flash and yield exact pricing."""
    out = estimate_run_cost(
        prompt_a_text="x",
        task_input="y",
        n_runs=1,
        target_model_id="deepseek/deepseek-v3",
        judge_model_id="openai/gpt-4o-mini",
        embedding_model_id="openai/text-embedding-3-small",
        expected_output_tokens=50,
    )
    assert out["pricing_status"] == "exact"
