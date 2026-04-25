"""Aggregate stats over many judge scores and pair votes.

Pure-Python implementations of the three statistics shown in the UI:

  - **summarize_overall_scores** — p10/p50/p90 quantiles + variance over the
    weighted overall scores produced by the judge for each output. Tightly
    bunched scores (low p90-p10 spread) signal a stable prompt.

  - **majority_vote** — for structured outputs (e.g. JSON), users may want to
    know "which value did most of the N runs return for field X?". This is
    plain mode/ratio.

  - **pair_winner_summary** — given the K pair-judge votes, decide the overall
    winner (A / B / tie) by win rate, weighted by individual judge confidence.
"""
from __future__ import annotations

from collections import Counter
from statistics import mean, pvariance


def quantile(values: list[float], q: float) -> float | None:
    """Return the q-th quantile (0..1) using linear interpolation. None if empty."""
    if not values:
        return None
    if not 0.0 <= q <= 1.0:
        raise ValueError("quantile q must be in [0, 1]")
    xs = sorted(values)
    if len(xs) == 1:
        return float(xs[0])
    pos = q * (len(xs) - 1)
    lo = int(pos)
    hi = min(lo + 1, len(xs) - 1)
    frac = pos - lo
    return xs[lo] + (xs[hi] - xs[lo]) * frac


def summarize_overall_scores(scores: list[float | None]) -> dict:
    """Return {p10, p50, p90, var, mean, count}. Drops None scores."""
    valid = [float(s) for s in scores if s is not None]
    if not valid:
        return {"p10": None, "p50": None, "p90": None, "var": None, "mean": None, "count": 0}
    return {
        "p10": quantile(valid, 0.10),
        "p50": quantile(valid, 0.50),
        "p90": quantile(valid, 0.90),
        "var": pvariance(valid) if len(valid) >= 2 else 0.0,
        "mean": mean(valid),
        "count": len(valid),
    }


def majority_vote(values: list) -> tuple[object | None, float]:
    """Return (most_common_value, fraction). Empty list → (None, 0.0)."""
    if not values:
        return None, 0.0
    counts = Counter(values)
    top_value, top_count = counts.most_common(1)[0]
    return top_value, top_count / len(values)


def pair_winner_summary(votes: list[dict]) -> dict:
    """Aggregate K pair-judge votes into a single decision.

    Each vote is ``{"winner": "A" | "B" | "tie", "confidence": float}``.

    Returned dict::

        {
          "winner": "A" | "B" | "tie",
          "win_rate_a": float,
          "win_rate_b": float,
          "tie_rate": float,
          "confidence": float,
        }

    The aggregate confidence is the win rate of the chosen side multiplied by
    the mean per-vote confidence on that side (or all votes for tie). Simple,
    interpretable, no statistical CI machinery — sufficient for MVP.
    """
    if not votes:
        return {
            "winner": "tie",
            "win_rate_a": 0.0,
            "win_rate_b": 0.0,
            "tie_rate": 0.0,
            "confidence": 0.0,
        }

    n = len(votes)
    a_votes = [v for v in votes if v.get("winner") == "A"]
    b_votes = [v for v in votes if v.get("winner") == "B"]
    tie_votes = [v for v in votes if v.get("winner") == "tie"]

    a = len(a_votes) / n
    b = len(b_votes) / n
    t = len(tie_votes) / n

    if a > b and a > t:
        winner = "A"
        chosen = a_votes
        win_rate = a
    elif b > a and b > t:
        winner = "B"
        chosen = b_votes
        win_rate = b
    else:
        winner = "tie"
        chosen = tie_votes if tie_votes else votes
        win_rate = max(t, max(a, b))

    confs = [float(v.get("confidence") or 0.0) for v in chosen if v.get("confidence") is not None]
    mean_conf = sum(confs) / len(confs) if confs else 0.5
    confidence = max(0.0, min(1.0, win_rate * mean_conf))

    return {
        "winner": winner,
        "win_rate_a": a,
        "win_rate_b": b,
        "tie_rate": t,
        "confidence": confidence,
    }
