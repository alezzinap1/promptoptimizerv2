"""One-shot meta-analysis after N stability outputs: weak spots + prompt fixes.

Uses ``LLMClient.generate_json`` with a fixed schema (Russian UX copy in prompts).
"""
from __future__ import annotations

import json
from typing import Any

# Sentinel so tests/mocks can distinguish synthesis from per-output judge calls.
SYNTHESIS_MARKER = "META_SYNTHESIS_V1"

_SYNTH_SYSTEM = f"""{SYNTHESIS_MARKER}
You are an expert prompt engineer. You receive one user task, the system prompt(s), rubric name, aggregate stats, and multiple target-model outputs with judge scores.
Identify systematic weaknesses and failure modes across runs — not random one-off quirks. Suggest concrete edits to the SYSTEM PROMPT(s), not full rewrites of answers.
Respond with a single JSON object only:
{{
  "summary": "string, 2-5 sentences, Russian",
  "failure_modes": [{{"pattern": "string", "evidence": "string", "severity": 1}}],
  "prompt_fixes": ["string — actionable instruction to add/change in the prompt"],
  "criteria_weak_spots": [{{"criterion_key": "string or *", "note": "string"}}]
}}
severity: 1 minor … 5 critical. Use empty arrays if nothing stands out."""

_MAX_EXCERPT = 2800


def _excerpt(text: str) -> str:
    t = (text or "").strip()
    if len(t) <= _MAX_EXCERPT:
        return t
    return t[: _MAX_EXCERPT] + "\n…[truncated]"


def result_rows_to_synthesis_outputs(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Map eval_results rows to the structure expected by ``build_synthesis_user_message``."""
    out: list[dict[str, Any]] = []
    for r in rows:
        if r.get("status") != "ok":
            continue
        out.append(
            {
                "side": r.get("prompt_side"),
                "run_index": r.get("run_index"),
                "judge_primary": r.get("judge_overall"),
                "judge_secondary": r.get("judge_overall_secondary"),
                "output_text": str(r.get("output_text") or ""),
            }
        )
    return out


def build_synthesis_user_message(
    *,
    task_input: str,
    prompt_a_text: str,
    prompt_b_text: str | None,
    rubric_snapshot: dict[str, Any],
    side_summaries: dict[str, dict],
    outputs: list[dict[str, Any]],
) -> str:
    """Build user message for the synthesis model."""
    crit_keys = [c.get("key", "") for c in (rubric_snapshot.get("criteria") or [])]
    lines = [
        "## Задача пользователя (task_input)",
        task_input.strip(),
        "",
        "## Промпт A",
        _excerpt(prompt_a_text),
    ]
    if prompt_b_text and prompt_b_text.strip():
        lines += ["", "## Промпт B", _excerpt(prompt_b_text)]
    lines += [
        "",
        f"## Рубрика: {rubric_snapshot.get('name', '')}",
        f"Критерии: {', '.join(crit_keys) or '(none)'}",
        "",
        "## Агрегаты по сторонам",
        json.dumps(side_summaries, ensure_ascii=False, indent=2),
        "",
        "## Выходы модели (сжато) и оценки судей",
    ]
    for o in outputs:
        lines.append(
            json.dumps(
                {
                    "side": o.get("side"),
                    "run_index": o.get("run_index"),
                    "judge_primary": o.get("judge_primary"),
                    "judge_secondary": o.get("judge_secondary"),
                    "output_excerpt": _excerpt(str(o.get("output_text", ""))),
                },
                ensure_ascii=False,
            )
        )
    return "\n".join(lines)


def run_synthesis(
    *,
    client,
    synthesis_model_id: str,
    task_input: str,
    prompt_a_text: str,
    prompt_b_text: str | None,
    rubric_snapshot: dict[str, Any],
    side_summaries: dict[str, dict],
    outputs: list[dict[str, Any]],
) -> dict[str, Any]:
    """Call LLM once; returns parsed dict (possibly empty on failure)."""
    user = build_synthesis_user_message(
        task_input=task_input,
        prompt_a_text=prompt_a_text,
        prompt_b_text=prompt_b_text,
        rubric_snapshot=rubric_snapshot,
        side_summaries=side_summaries,
        outputs=outputs,
    )
    return client.generate_json(
        system_prompt=_SYNTH_SYSTEM,
        user_content=user,
        provider=synthesis_model_id,
        max_tokens=2048,
    )
