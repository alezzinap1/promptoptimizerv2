"""Diversity score from embedding vectors."""
from __future__ import annotations

import math

from services.eval.diversity import (
    cosine_similarity,
    diversity_summary,
    pairwise_diversity,
)


def test_cosine_identical_is_one() -> None:
    assert abs(cosine_similarity([1.0, 0.0], [1.0, 0.0]) - 1.0) < 1e-9


def test_cosine_orthogonal_is_zero() -> None:
    assert abs(cosine_similarity([1.0, 0.0], [0.0, 1.0])) < 1e-9


def test_cosine_opposite_is_minus_one() -> None:
    assert abs(cosine_similarity([1.0, 0.0], [-1.0, 0.0]) - (-1.0)) < 1e-9


def test_cosine_zero_vector_is_zero() -> None:
    assert cosine_similarity([0.0, 0.0], [1.0, 1.0]) == 0.0


def test_pairwise_diversity_identical_outputs_is_zero() -> None:
    vectors = [[1.0, 0.0]] * 4
    assert abs(pairwise_diversity(vectors)) < 1e-9


def test_pairwise_diversity_orthogonal_pair_is_one() -> None:
    vectors = [[1.0, 0.0], [0.0, 1.0]]
    assert abs(pairwise_diversity(vectors) - 1.0) < 1e-9


def test_pairwise_diversity_under_two_returns_zero() -> None:
    assert pairwise_diversity([]) == 0.0
    assert pairwise_diversity([[1.0, 2.0]]) == 0.0


def test_diversity_summary_returns_all_stats() -> None:
    vectors = [[1.0, 0.0], [0.0, 1.0], [math.sqrt(0.5), math.sqrt(0.5)]]
    s = diversity_summary(vectors)
    assert {"diversity_score", "mean_pair_sim", "min_pair_sim", "max_pair_sim"} <= s.keys()
    assert 0.0 <= s["diversity_score"] <= 1.0
    assert s["min_pair_sim"] <= s["max_pair_sim"]
