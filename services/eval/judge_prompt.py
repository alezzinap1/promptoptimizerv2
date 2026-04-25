"""Builders for judge LLM prompts (single + pair modes).

The judge sees a rubric (criterion → weight + anchors), the prompt and task
input that produced an output, and the output itself, then returns a strict
JSON document with per-criterion scores.

Single-mode JSON contract::

    {
      "scores": {
        "<criterion_key>": {"score": <number 0..5>, "reasoning": "<one sentence>"}
      },
      "overall": <number 0..5>,
      "reasoning": "<2-3 sentence overall explanation>"
    }

Pair-mode JSON contract::

    {
      "winner": "A" | "B" | "tie",
      "confidence": <number 0..1>,
      "reasoning": "<2-3 sentence comparison>"
    }
"""
from __future__ import annotations


def _format_criteria_block(criteria: list[dict]) -> str:
    """Render the rubric as a numbered list with anchors."""
    lines: list[str] = []
    for i, crit in enumerate(criteria, start=1):
        anchors = crit.get("anchors") or {}
        anchor_lines = "\n".join(
            f"      {score} = {desc}"
            for score, desc in sorted(anchors.items(), key=lambda kv: float(kv[0]))
        )
        lines.append(
            f"{i}. {crit['key']} (weight {crit.get('weight', 1.0)}): "
            f"{crit.get('description', '')}\n"
            f"   Anchors:\n{anchor_lines}"
        )
    return "\n\n".join(lines)


def _criterion_keys_csv(criteria: list[dict]) -> str:
    return ", ".join(f'"{c["key"]}"' for c in criteria)


def build_single_judge_prompt(
    *,
    rubric: dict,
    prompt_text: str,
    task_input: str,
    output_text: str,
    reference_answer: str | None = None,
) -> tuple[str, str]:
    """Return ``(system, user)`` strings for grading a single output.

    The judge is asked to score every criterion on a 0..5 scale, anchor-by-anchor,
    then compute a weighted ``overall``. Output must be strict JSON.
    """
    criteria = list(rubric.get("criteria") or [])
    criteria_block = _format_criteria_block(criteria)
    keys_csv = _criterion_keys_csv(criteria)

    system = (
        "You are a strict evaluator. You grade a model's output using the rubric "
        "below. For each criterion you must pick a number from 0 to 5 by matching "
        "the output against the listed anchors (use intermediate values like 4 if "
        "the output sits between two anchors).\n\n"
        f"Rubric:\n{criteria_block}\n\n"
        "Then compute an overall score (weighted average of criterion scores, "
        "rounded to one decimal).\n\n"
        "Respond with strict JSON in this exact shape (no prose outside JSON):\n"
        "{\n"
        f'  "scores": {{ /* keys: {keys_csv} */ }},\n'
        '  "overall": <number 0..5>,\n'
        '  "reasoning": "<2-3 sentence overall explanation>"\n'
        "}\n"
        "Each entry under \"scores\" is "
        '{"score": <0..5>, "reasoning": "<one sentence>"}.'
    )

    parts = [
        "PROMPT (sent to the model):",
        prompt_text.strip(),
        "",
        "TASK INPUT:",
        task_input.strip(),
        "",
        "OUTPUT TO EVALUATE:",
        output_text.strip(),
    ]
    if reference_answer:
        parts += ["", "REFERENCE ANSWER (use as ground truth where applicable):", reference_answer.strip()]
    user = "\n".join(parts)
    return system, user


def build_pair_judge_prompt(
    *,
    rubric: dict,
    prompt_a_text: str,
    prompt_b_text: str,
    task_input: str,
    output_a: str,
    output_b: str,
    reference_answer: str | None = None,
) -> tuple[str, str]:
    """Return ``(system, user)`` strings for an A-vs-B comparison.

    Asks the judge to pick a winner using the rubric as guidance. We do NOT
    ask for per-criterion scores here — pair-mode is meant to be cheap and
    its goal is just a winner + confidence.
    """
    criteria = list(rubric.get("criteria") or [])
    criteria_block = _format_criteria_block(criteria)

    system = (
        "You compare two model outputs (A and B) for the same task. You must "
        "pick a winner using this rubric as guidance.\n\n"
        f"Rubric:\n{criteria_block}\n\n"
        "Be impartial: do NOT favor longer or shorter outputs unless conciseness "
        "is in the rubric. Ignore which side was labeled 'A' vs 'B' when judging.\n\n"
        "Respond with strict JSON (no prose outside JSON):\n"
        "{\n"
        '  "winner": "A" | "B" | "tie",\n'
        '  "confidence": <number 0..1>,\n'
        '  "reasoning": "<2-3 sentence comparison>"\n'
        "}\n"
    )

    parts = [
        "PROMPT A:",
        prompt_a_text.strip(),
        "",
        "PROMPT B:",
        prompt_b_text.strip(),
        "",
        "TASK INPUT:",
        task_input.strip(),
        "",
        "OUTPUT A:",
        output_a.strip(),
        "",
        "OUTPUT B:",
        output_b.strip(),
    ]
    if reference_answer:
        parts += ["", "REFERENCE ANSWER (ground truth):", reference_answer.strip()]
    user = "\n".join(parts)
    return system, user
