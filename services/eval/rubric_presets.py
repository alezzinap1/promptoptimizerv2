"""Built-in rubric presets for the LLM-as-judge.

Each rubric is a list of criteria; each criterion has:
  - ``key`` — short identifier used in JSON results
  - ``weight`` — multiplier applied when computing weighted overall (0..1)
  - ``description`` — short human-readable explanation
  - ``anchors`` — dict ``{"0": "...", "3": "...", "5": "..."}``: what these
                  scores mean. The judge sees these and matches outputs to anchors
                  (G-Eval style) instead of guessing a number.

We deliberately keep the preset list small and high-quality. Users can clone
a preset into their own rubric (see DB ``eval_rubrics.preset_key``).
"""
from __future__ import annotations

from typing import Any


PRESET_RUBRICS: dict[str, dict[str, Any]] = {
    "default_g_eval": {
        "name": "Default (G-Eval, 5 criteria)",
        "reference_required": False,
        "criteria": [
            {
                "key": "accuracy",
                "weight": 1.0,
                "description": "Is the response factually correct and addresses the question?",
                "anchors": {
                    "0": "Mostly wrong or hallucinated.",
                    "3": "Partially correct; minor factual errors.",
                    "5": "Fully correct, no factual errors.",
                },
            },
            {
                "key": "completeness",
                "weight": 1.0,
                "description": "Does the response cover all parts of the question?",
                "anchors": {
                    "0": "Major parts missing.",
                    "3": "Covers most; some gaps remain.",
                    "5": "Fully covers every requested aspect.",
                },
            },
            {
                "key": "clarity",
                "weight": 0.7,
                "description": "Is the response clear, well-structured and free of jargon?",
                "anchors": {
                    "0": "Confusing or hard to read.",
                    "3": "Generally clear with rough spots.",
                    "5": "Crisp, well-organized, easy to follow.",
                },
            },
            {
                "key": "instruction_following",
                "weight": 1.0,
                "description": "Does the response follow the explicit format / style asked for?",
                "anchors": {
                    "0": "Ignores the requested format/style.",
                    "3": "Follows most instructions; misses a detail.",
                    "5": "Follows every formatting/style instruction.",
                },
            },
            {
                "key": "conciseness",
                "weight": 0.5,
                "description": "Is the response free of filler / unnecessary verbosity?",
                "anchors": {
                    "0": "Bloated, repetitive, off-topic content.",
                    "3": "Slightly verbose.",
                    "5": "Tight, no filler.",
                },
            },
        ],
    },
    "code": {
        "name": "Code generation (4 criteria)",
        "reference_required": False,
        "criteria": [
            {
                "key": "correctness",
                "weight": 1.0,
                "description": "Does the code solve the problem and pass mental tests?",
                "anchors": {
                    "0": "Fails on the obvious case.",
                    "3": "Works for happy path; edge cases may fail.",
                    "5": "Works for happy path AND edge cases.",
                },
            },
            {
                "key": "robustness",
                "weight": 0.8,
                "description": "Handles invalid input, errors, and edge cases properly.",
                "anchors": {
                    "0": "Crashes / silent wrong output on bad input.",
                    "3": "Handles a few obvious edge cases.",
                    "5": "Defensive against bad input with proper errors.",
                },
            },
            {
                "key": "readability",
                "weight": 0.6,
                "description": "Naming, structure, comments, idiomatic style.",
                "anchors": {
                    "0": "Cryptic naming, monolithic, no structure.",
                    "3": "Readable but inconsistent.",
                    "5": "Idiomatic, well-named, easy to maintain.",
                },
            },
            {
                "key": "complexity",
                "weight": 0.4,
                "description": "Reasonable algorithmic complexity for the task at hand.",
                "anchors": {
                    "0": "Quadratic or worse where linear is expected.",
                    "3": "Acceptable but not optimal.",
                    "5": "Best practical complexity.",
                },
            },
        ],
    },
    "creative": {
        "name": "Creative writing (3 criteria)",
        "reference_required": False,
        "criteria": [
            {
                "key": "originality",
                "weight": 1.0,
                "description": "Avoids clichés; brings a fresh angle.",
                "anchors": {
                    "0": "Pure cliché / generic.",
                    "3": "Mix of fresh and generic.",
                    "5": "Distinctive, surprising in a good way.",
                },
            },
            {
                "key": "fluency",
                "weight": 0.8,
                "description": "Reads naturally; rhythm, vocabulary, syntax flow.",
                "anchors": {
                    "0": "Awkward, stilted prose.",
                    "3": "Reads okay; small slips.",
                    "5": "Fluid, polished prose.",
                },
            },
            {
                "key": "on_topic",
                "weight": 0.7,
                "description": "Stays on the requested topic / brief.",
                "anchors": {
                    "0": "Drifts away from the brief.",
                    "3": "Mostly on-topic with detours.",
                    "5": "Tightly on-brief.",
                },
            },
        ],
    },
    "json": {
        "name": "Structured JSON output (3 criteria)",
        "reference_required": False,
        "criteria": [
            {
                "key": "schema_adherence",
                "weight": 1.0,
                "description": "Output is valid JSON and uses the requested fields/types.",
                "anchors": {
                    "0": "Invalid JSON or wrong shape.",
                    "3": "Valid JSON, some fields wrong type/missing.",
                    "5": "Valid JSON matching the requested schema exactly.",
                },
            },
            {
                "key": "completeness",
                "weight": 1.0,
                "description": "Every required field is present and non-empty.",
                "anchors": {
                    "0": "Many required fields missing.",
                    "3": "A couple fields missing.",
                    "5": "All fields filled.",
                },
            },
            {
                "key": "accuracy",
                "weight": 1.0,
                "description": "Field values are correct given the input.",
                "anchors": {
                    "0": "Most field values wrong.",
                    "3": "Some fields correct.",
                    "5": "All fields correct.",
                },
            },
        ],
    },
    "reference_match": {
        "name": "Reference-based (similarity to a known good answer)",
        "reference_required": True,
        "criteria": [
            {
                "key": "semantic_match",
                "weight": 1.0,
                "description": "Captures the same meaning as the reference, even if worded differently.",
                "anchors": {
                    "0": "Different meaning entirely.",
                    "3": "Some overlap with reference; misses key points.",
                    "5": "Same meaning as reference.",
                },
            },
            {
                "key": "factual_match",
                "weight": 1.0,
                "description": "Facts, numbers and key entities match the reference.",
                "anchors": {
                    "0": "Contradicts reference facts.",
                    "3": "Most facts correct, one or two off.",
                    "5": "All key facts match the reference.",
                },
            },
            {
                "key": "style_match",
                "weight": 0.5,
                "description": "Writing style and format are close enough to the reference.",
                "anchors": {
                    "0": "Completely different style/format.",
                    "3": "Style only loosely similar.",
                    "5": "Style and format mirror the reference.",
                },
            },
        ],
    },
}


def list_preset_rubrics() -> list[dict]:
    """Return all presets as a list of dicts annotated with their key."""
    return [
        {"preset_key": k, **v} for k, v in PRESET_RUBRICS.items()
    ]


def get_preset_rubric(preset_key: str) -> dict | None:
    """Return the preset dict for `preset_key` or None if unknown."""
    rubric = PRESET_RUBRICS.get(preset_key)
    if not rubric:
        return None
    return {"preset_key": preset_key, **rubric}
