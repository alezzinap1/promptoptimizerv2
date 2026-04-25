"""Run the LLM judge over a single output (rubric grade) or a pair (A vs B).

The runner is intentionally tolerant: judge LLMs sometimes wrap their JSON
in markdown fences, miss a key, or return non-numeric scores. We:
  - never raise on a bad response — we return ``error`` instead so the run
    can keep going; an individual failed grade just shows up as null in stats
  - clamp scores into the documented ranges (0..5 for criteria, 0..1 for confidence)
  - if the judge omits ``overall`` we derive it as the weighted mean of provided
    criterion scores (same formula the judge is told to use)
"""
from __future__ import annotations

import logging
from typing import Any

from services.eval.judge_prompt import (
    build_pair_judge_prompt,
    build_single_judge_prompt,
)

logger = logging.getLogger(__name__)


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _weighted_mean(scores: list[dict], rubric: dict) -> float | None:
    """Compute weighted mean using rubric weights (default 1.0 if missing)."""
    weights = {c["key"]: float(c.get("weight", 1.0)) for c in rubric.get("criteria", [])}
    num = 0.0
    den = 0.0
    for s in scores:
        sv = _to_float(s.get("score"))
        if sv is None:
            continue
        w = weights.get(s.get("criterion_key", ""), 1.0)
        num += sv * w
        den += w
    if den == 0:
        return None
    return round(num / den, 4)


def judge_one(
    *,
    client,
    judge_model_id: str,
    rubric: dict,
    prompt_text: str,
    task_input: str,
    output_text: str,
    reference_answer: str | None = None,
) -> dict:
    """Grade a single output with the rubric. Returns a structured dict.

    Result shape::

        {
          "overall": float | None,
          "scores": [{"criterion_key": str, "score": float, "reasoning": str|None}, ...],
          "reasoning": str | None,
          "raw": dict,
          "error": str | None,
        }
    """
    system, user = build_single_judge_prompt(
        rubric=rubric,
        prompt_text=prompt_text,
        task_input=task_input,
        output_text=output_text,
        reference_answer=reference_answer,
    )
    try:
        raw = client.generate_json(
            system_prompt=system, user_content=user, provider=judge_model_id, max_tokens=800
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("judge_one: LLM call failed: %s", exc)
        return {"overall": None, "scores": [], "reasoning": None, "raw": {}, "error": str(exc)}

    if not isinstance(raw, dict) or not raw:
        return {"overall": None, "scores": [], "reasoning": None, "raw": raw or {}, "error": "empty response"}

    scores_obj = raw.get("scores")
    parsed_scores: list[dict] = []
    if isinstance(scores_obj, dict):
        for key, val in scores_obj.items():
            if isinstance(val, dict):
                score = _to_float(val.get("score"))
                reasoning = val.get("reasoning")
            else:
                score = _to_float(val)
                reasoning = None
            if score is None:
                continue
            parsed_scores.append(
                {
                    "criterion_key": str(key),
                    "score": _clamp(score, 0.0, 5.0),
                    "reasoning": reasoning,
                }
            )

    overall = _to_float(raw.get("overall"))
    if overall is None:
        overall = _weighted_mean(parsed_scores, rubric)
    elif overall is not None:
        overall = _clamp(overall, 0.0, 5.0)

    return {
        "overall": overall,
        "scores": parsed_scores,
        "reasoning": raw.get("reasoning"),
        "raw": raw,
        "error": None,
    }


def judge_pair(
    *,
    client,
    judge_model_id: str,
    rubric: dict,
    prompt_a_text: str,
    prompt_b_text: str,
    task_input: str,
    output_a: str,
    output_b: str,
    reference_answer: str | None = None,
) -> dict:
    """Compare A vs B with the rubric as guidance.

    Result shape::

        {
          "winner": "A" | "B" | "tie",
          "confidence": float (0..1),
          "reasoning": str | None,
          "raw": dict,
          "error": str | None,
        }
    """
    system, user = build_pair_judge_prompt(
        rubric=rubric,
        prompt_a_text=prompt_a_text,
        prompt_b_text=prompt_b_text,
        task_input=task_input,
        output_a=output_a,
        output_b=output_b,
        reference_answer=reference_answer,
    )
    try:
        raw = client.generate_json(
            system_prompt=system, user_content=user, provider=judge_model_id, max_tokens=400
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("judge_pair: LLM call failed: %s", exc)
        return {"winner": "tie", "confidence": 0.0, "reasoning": None, "raw": {}, "error": str(exc)}

    if not isinstance(raw, dict) or not raw:
        return {"winner": "tie", "confidence": 0.0, "reasoning": None, "raw": raw or {}, "error": "empty response"}

    winner_raw = str(raw.get("winner") or "").strip().upper()
    if winner_raw == "A":
        winner = "A"
    elif winner_raw == "B":
        winner = "B"
    else:
        winner = "tie"

    confidence = _to_float(raw.get("confidence"))
    if confidence is None:
        confidence = 0.5
    confidence = _clamp(confidence, 0.0, 1.0)

    return {
        "winner": winner,
        "confidence": confidence,
        "reasoning": raw.get("reasoning"),
        "raw": raw,
        "error": None,
    }
