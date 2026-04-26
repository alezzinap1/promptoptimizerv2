"""Token + USD cost estimator for stability evaluation runs.

Estimates four work streams:

  - **target generation** — running prompt(s) on the target model N times
    (×2 in pair mode, since each side gets the same N runs)
  - **judge** — one rubric-grade call per generated output
  - **pair-judge** — extra A-vs-B comparisons (only in pair mode)
  - **embeddings** — one embedding per generated output (for diversity score)

Pricing source: OpenRouter pricing as of April 2026. Unknown models fall back
to a conservative average, and the response is tagged ``pricing_status="approximate"``
so the UI can warn the user.

Output cost is intentionally based on a *user-provided* `expected_output_tokens`
budget — the real run is capped at the same number, so this is also the worst case.
"""
from __future__ import annotations

from core.tokenizer import count_tokens
from services.llm_client import resolve_openrouter_model_id

# USD per 1 token. Source: OpenRouter (Apr 2026, snapshot).
# Numbers are per-token (1/1_000_000 of the per-million USD rate) for direct multiplication.
_K = 1_000_000.0
MODEL_PRICING_PER_TOKEN: dict[str, dict[str, float]] = {
    # ── Targets / generators (chat) ─────────────────────────────────────
    "openai/gpt-4o":                    {"input": 5.0 / _K,   "output": 15.0 / _K},
    "openai/gpt-4o-mini":               {"input": 0.15 / _K,  "output": 0.60 / _K},
    "anthropic/claude-3.5-sonnet":      {"input": 3.0 / _K,   "output": 15.0 / _K},
    "anthropic/claude-3-haiku":         {"input": 0.25 / _K,  "output": 1.25 / _K},
    "google/gemini-pro-1.5":            {"input": 1.25 / _K,  "output": 5.0 / _K},
    "google/gemini-2.0-flash-001":      {"input": 0.075 / _K, "output": 0.30 / _K},
    "google/gemini-flash-1.5":          {"input": 0.075 / _K, "output": 0.30 / _K},
    "deepseek/deepseek-v4-flash":       {"input": 0.10 / _K,  "output": 0.30 / _K},
    "deepseek/deepseek-r1":             {"input": 0.55 / _K,  "output": 2.19 / _K},
    "qwen/qwen3-235b-a22b":             {"input": 0.50 / _K,  "output": 1.50 / _K},
    "x-ai/grok-3-mini-beta":            {"input": 0.30 / _K,  "output": 0.50 / _K},
    "mistralai/mistral-nemo":           {"input": 0.13 / _K,  "output": 0.13 / _K},
    # ── Embeddings (input-only pricing) ─────────────────────────────────
    "openai/text-embedding-3-small":    {"input": 0.02 / _K,  "output": 0.0},
    "openai/text-embedding-3-large":    {"input": 0.13 / _K,  "output": 0.0},
}

# Conservative fallback when a model is unknown (mid-tier rates).
_FALLBACK_PRICING: dict[str, float] = {"input": 1.0 / _K, "output": 3.0 / _K}

# Per-call overhead for the judge prompt itself (system + rubric + JSON instructions).
_JUDGE_SYSTEM_OVERHEAD_TOKENS = 600
_JUDGE_OUTPUT_TOKENS = 250
_PAIR_JUDGE_OUTPUT_TOKENS = 200
_SYNTH_SYSTEM_OVERHEAD = 900
_SYNTH_OUTPUT_TOKENS = 1400
# Per-output excerpt (~chars) counted into synthesis input (aligned with services.eval.synthesis).
_SYNTH_EXCERPT_CHARS = 2800


def _tokens(text: str, model_id: str) -> int:
    if not text:
        return 0
    return int(count_tokens(text, model_id).get("tokens", 0))


def _pricing_for(model_id: str) -> tuple[dict[str, float], bool]:
    """Return (pricing_dict, is_exact). Resolves deprecated aliases."""
    resolved = resolve_openrouter_model_id(model_id)
    if resolved in MODEL_PRICING_PER_TOKEN:
        return MODEL_PRICING_PER_TOKEN[resolved], True
    return _FALLBACK_PRICING, False


def estimate_run_cost(
    *,
    prompt_a_text: str,
    task_input: str,
    n_runs: int,
    target_model_id: str,
    judge_model_id: str,
    embedding_model_id: str,
    expected_output_tokens: int = 600,
    prompt_b_text: str | None = None,
    reference_answer: str | None = None,
    pair_judge_samples: int = 0,
    judge_secondary_model_id: str | None = None,
    run_synthesis: bool = True,
    synthesis_model_id: str | None = None,
    meta_synthesis_mode: str = "full",
) -> dict:
    """Estimate token usage and USD for a stability run.

    Pair mode is detected by ``prompt_b_text not None``. ``pair_judge_samples``
    is the number of extra A-vs-B comparisons the judge will perform; ignored
    in single mode.
    """
    is_pair = prompt_b_text is not None and prompt_b_text.strip() != ""
    n_runs = max(1, int(n_runs))

    target_pricing, target_exact = _pricing_for(target_model_id)
    judge_pricing, judge_exact = _pricing_for(judge_model_id)
    sec_model = (judge_secondary_model_id or "").strip()
    use_secondary = bool(sec_model and sec_model != (judge_model_id or "").strip())
    synth_model = (synthesis_model_id or judge_model_id).strip()
    judge2_pricing, judge2_exact = _pricing_for(sec_model) if use_secondary else (judge_pricing, judge_exact)
    synth_pricing, synth_exact = _pricing_for(synth_model)
    embed_pricing, embed_exact = _pricing_for(embedding_model_id)
    is_exact = (
        target_exact
        and judge_exact
        and embed_exact
        and (not use_secondary or judge2_exact)
        and (not run_synthesis or synth_exact)
    )

    # ── Target generation ───────────────────────────────────────────────
    a_in = _tokens(prompt_a_text, target_model_id) + _tokens(task_input, target_model_id)
    b_in = _tokens(prompt_b_text or "", target_model_id) + _tokens(task_input, target_model_id) if is_pair else 0
    target_calls_a = n_runs
    target_calls_b = n_runs if is_pair else 0
    target_input_tokens = a_in * target_calls_a + b_in * target_calls_b
    target_output_tokens = expected_output_tokens * (target_calls_a + target_calls_b)
    target_usd = (
        target_input_tokens * target_pricing["input"]
        + target_output_tokens * target_pricing["output"]
    )

    # ── Single-output judge (rubric grading per output) ────────────────
    judge_calls = target_calls_a + target_calls_b
    ref_in = _tokens(reference_answer or "", judge_model_id)
    # Per call: prompt tokens + task tokens + output tokens + reference + system overhead
    per_call_judge_input = (
        _tokens(prompt_a_text, judge_model_id)
        + _tokens(task_input, judge_model_id)
        + expected_output_tokens
        + ref_in
        + _JUDGE_SYSTEM_OVERHEAD_TOKENS
    )
    pri_in = per_call_judge_input * judge_calls
    pri_out = _JUDGE_OUTPUT_TOKENS * judge_calls

    sec_in = 0
    sec_out = 0
    judge_secondary_usd = 0.0
    if use_secondary:
        per_b = (
            _tokens(prompt_a_text, sec_model)
            + _tokens(task_input, sec_model)
            + expected_output_tokens
            + ref_in
            + _JUDGE_SYSTEM_OVERHEAD_TOKENS
        )
        sec_in = per_b * judge_calls
        sec_out = _JUDGE_OUTPUT_TOKENS * judge_calls
        judge_secondary_usd = sec_in * judge2_pricing["input"] + sec_out * judge2_pricing["output"]

    # ── Pair-judge (A-vs-B comparisons, sampled) ───────────────────────
    pair_in = 0
    pair_out = 0
    if is_pair and pair_judge_samples > 0:
        per_pair_input = (
            _tokens(prompt_a_text, judge_model_id)
            + _tokens(prompt_b_text or "", judge_model_id)
            + _tokens(task_input, judge_model_id)
            + 2 * expected_output_tokens
            + _JUDGE_SYSTEM_OVERHEAD_TOKENS
        )
        pair_in = per_pair_input * pair_judge_samples
        pair_out = _PAIR_JUDGE_OUTPUT_TOKENS * pair_judge_samples

    judge_input_tokens = pri_in + sec_in + pair_in
    judge_output_tokens = pri_out + sec_out + pair_out

    judge_usd = (
        pri_in * judge_pricing["input"]
        + pri_out * judge_pricing["output"]
        + pair_in * judge_pricing["input"]
        + pair_out * judge_pricing["output"]
    )
    if use_secondary:
        judge_usd += judge_secondary_usd

    synthesis_usd = 0.0
    synthesis_input_tokens = 0
    synthesis_output_tokens = 0
    if run_synthesis:
        n_out = target_calls_a + target_calls_b
        excerpt_tok = max(1, int(_SYNTH_EXCERPT_CHARS // 3))
        synth_in = (
            _tokens(task_input, synth_model)
            + _tokens(prompt_a_text, synth_model)
            + _tokens(prompt_b_text or "", synth_model)
            + _tokens(reference_answer or "", synth_model)
            + n_out * excerpt_tok
            + _SYNTH_SYSTEM_OVERHEAD
        )
        # Full meta pipeline: two LLM JSON calls (hypothesize + final). Lite: single synthesis pass.
        layers = 1 if str(meta_synthesis_mode).strip().lower() == "lite" else 2
        synthesis_input_tokens = synth_in * layers
        synthesis_output_tokens = _SYNTH_OUTPUT_TOKENS * layers
        one_call_usd = (
            synth_in * synth_pricing["input"]
            + _SYNTH_OUTPUT_TOKENS * synth_pricing["output"]
        )
        synthesis_usd = one_call_usd * layers

    # ── Embeddings (one per output) ────────────────────────────────────
    embedding_input_tokens = expected_output_tokens * (target_calls_a + target_calls_b)
    embedding_usd = embedding_input_tokens * embed_pricing["input"]

    total_tokens = (
        target_input_tokens
        + target_output_tokens
        + judge_input_tokens
        + judge_output_tokens
        + embedding_input_tokens
        + synthesis_input_tokens
        + synthesis_output_tokens
    )
    total_usd = target_usd + judge_usd + embedding_usd + synthesis_usd

    return {
        "target": {
            "input_tokens": target_input_tokens,
            "output_tokens": target_output_tokens,
            "usd": round(target_usd, 6),
        },
        "judge": {
            "input_tokens": judge_input_tokens,
            "output_tokens": judge_output_tokens,
            "usd": round(judge_usd, 6),
        },
        "synthesis": {
            "input_tokens": synthesis_input_tokens,
            "output_tokens": synthesis_output_tokens,
            "usd": round(synthesis_usd, 6),
        },
        "embedding": {
            "input_tokens": embedding_input_tokens,
            "usd": round(embedding_usd, 6),
        },
        "total_tokens": int(total_tokens),
        "total_usd": round(total_usd, 6),
        "pricing_status": "exact" if is_exact else "approximate",
    }
