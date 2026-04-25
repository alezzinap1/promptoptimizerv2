"""Diversity (semantic spread) score for a set of N embedding vectors.

A stability run produces N outputs. We embed each output and compute a
**diversity score** in [0, 1]:

  - 0 → outputs are semantically identical → high stability
  - 1 → outputs are semantically orthogonal → wildly inconsistent

The score is ``1 - mean_pairwise_cosine_similarity``, clamped to [0, 1].
This is a simple, well-understood metric (used in NLP self-consistency papers).

Pure-Python: avoids depending on numpy for what amounts to N×(N-1)/2 dot products
on short vectors. Embeddings here are typically 1536-d for ``text-embedding-3-small``;
N is at most ~40, so this runs in microseconds.
"""
from __future__ import annotations

import math


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Return cosine similarity in [-1, 1]. Returns 0.0 for any zero vector."""
    if len(a) != len(b):
        raise ValueError(f"vector length mismatch: {len(a)} vs {len(b)}")
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    denom = math.sqrt(na) * math.sqrt(nb)
    if denom == 0.0:
        return 0.0
    return dot / denom


def pairwise_diversity(vectors: list[list[float]]) -> float:
    """Mean pairwise (1 - cosine) over all unordered pairs, clamped to [0, 1]."""
    n = len(vectors)
    if n < 2:
        return 0.0
    total = 0.0
    pairs = 0
    for i in range(n):
        for j in range(i + 1, n):
            total += 1.0 - cosine_similarity(vectors[i], vectors[j])
            pairs += 1
    score = total / max(pairs, 1)
    return max(0.0, min(1.0, score))


def diversity_summary(vectors: list[list[float]]) -> dict:
    """Full breakdown — useful for debugging / displaying min/max similarity pairs."""
    n = len(vectors)
    if n < 2:
        return {
            "diversity_score": 0.0,
            "mean_pair_sim": 1.0 if n == 1 else 0.0,
            "min_pair_sim": 1.0 if n == 1 else 0.0,
            "max_pair_sim": 1.0 if n == 1 else 0.0,
        }
    sims: list[float] = []
    for i in range(n):
        for j in range(i + 1, n):
            sims.append(cosine_similarity(vectors[i], vectors[j]))
    mean_sim = sum(sims) / len(sims)
    return {
        "diversity_score": max(0.0, min(1.0, 1.0 - mean_sim)),
        "mean_pair_sim": mean_sim,
        "min_pair_sim": min(sims),
        "max_pair_sim": max(sims),
    }
