"""Deterministic clustering of eval outputs by embedding similarity (no numpy)."""
from __future__ import annotations

import math
from typing import Any


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na < 1e-12 or nb < 1e-12:
        return 0.0
    return dot / (na * nb)


def cluster_result_ids_by_embedding(
    items: list[dict[str, Any]],
    *,
    sim_threshold: float = 0.88,
) -> list[list[int]]:
    """Each item: {id: result_id, embedding: list[float]}. Returns clusters of result ids."""
    valid = [it for it in items if it.get("embedding") and isinstance(it["embedding"], list)]
    if not valid:
        return [[int(it["id"]) for it in items if it.get("id") is not None]]
    ids = [int(v["id"]) for v in valid]
    embs = [v["embedding"] for v in valid]
    n = len(ids)
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[rj] = ri

    for i in range(n):
        for j in range(i + 1, n):
            if _cosine(embs[i], embs[j]) >= sim_threshold:
                union(i, j)

    buckets: dict[int, list[int]] = {}
    for i in range(n):
        r = find(i)
        buckets.setdefault(r, []).append(ids[i])
    clusters = list(buckets.values())
    clusters.sort(key=lambda c: min(c))
    return clusters
