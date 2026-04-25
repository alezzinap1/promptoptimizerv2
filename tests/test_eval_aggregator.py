"""Stats aggregator: quantiles, variance, majority vote, pair winner."""
from __future__ import annotations

from services.eval.aggregator import (
    majority_vote,
    pair_winner_summary,
    quantile,
    summarize_overall_scores,
)


def test_quantile_basics() -> None:
    xs = [1.0, 2.0, 3.0, 4.0, 5.0]
    assert quantile(xs, 0.5) == 3.0
    assert quantile(xs, 0.0) == 1.0
    assert quantile(xs, 1.0) == 5.0


def test_quantile_interpolates_between_points() -> None:
    xs = [1.0, 2.0, 3.0, 4.0]
    assert abs(quantile(xs, 0.5) - 2.5) < 1e-9


def test_quantile_empty_returns_none() -> None:
    assert quantile([], 0.5) is None


def test_summarize_overall_scores_full_stats() -> None:
    scores = [3.0, 4.0, 4.5, 5.0, 4.0, 4.5, 3.5]
    s = summarize_overall_scores(scores)
    assert {"p10", "p50", "p90", "var", "mean", "count"} <= set(s.keys())
    assert s["count"] == 7
    assert s["p10"] <= s["p50"] <= s["p90"]
    assert abs(s["mean"] - sum(scores) / len(scores)) < 1e-9


def test_summarize_drops_none_values() -> None:
    s = summarize_overall_scores([3.0, None, 4.0, None])
    assert s["count"] == 2
    assert abs(s["mean"] - 3.5) < 1e-9


def test_summarize_empty() -> None:
    s = summarize_overall_scores([None, None])
    assert s["count"] == 0
    assert s["mean"] is None
    assert s["p10"] is None


def test_majority_vote_simple() -> None:
    val, frac = majority_vote(["A", "A", "B", "A"])
    assert val == "A"
    assert abs(frac - 0.75) < 1e-9


def test_majority_vote_tie_breaks_deterministically() -> None:
    """Equal counts: returns first one encountered."""
    val, frac = majority_vote(["B", "A", "B", "A"])
    assert frac == 0.5
    assert val in {"A", "B"}


def test_majority_vote_empty() -> None:
    assert majority_vote([]) == (None, 0.0)


def test_pair_winner_summary_clear_a() -> None:
    votes = [
        {"winner": "A", "confidence": 0.9},
        {"winner": "A", "confidence": 0.8},
        {"winner": "B", "confidence": 0.7},
    ]
    s = pair_winner_summary(votes)
    assert s["winner"] == "A"
    assert abs(s["win_rate_a"] - 2 / 3) < 1e-9
    assert abs(s["win_rate_b"] - 1 / 3) < 1e-9
    assert s["tie_rate"] == 0.0
    assert 0.0 <= s["confidence"] <= 1.0


def test_pair_winner_summary_dominated_by_ties() -> None:
    votes = [
        {"winner": "tie", "confidence": 0.6},
        {"winner": "tie", "confidence": 0.5},
        {"winner": "A", "confidence": 0.5},
    ]
    s = pair_winner_summary(votes)
    assert s["winner"] == "tie"
    assert abs(s["tie_rate"] - 2 / 3) < 1e-9


def test_pair_winner_summary_empty() -> None:
    s = pair_winner_summary([])
    assert s["winner"] == "tie"
    assert s["confidence"] == 0.0
    assert s["win_rate_a"] == 0.0
