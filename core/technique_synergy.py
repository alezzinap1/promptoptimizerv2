"""
Technique synergy — scoring-based technique selection with family quotas,
input feature boosts, and cross-technique compatibility awareness.

Replaces the simple boolean-match approach in technique_registry.select_techniques.
"""
from __future__ import annotations

import re
from typing import Any

# ---------------------------------------------------------------------------
# Technique families — max 1 per family (unless complexity=high allows 2 from reasoning)
# ---------------------------------------------------------------------------
TECHNIQUE_FAMILIES: dict[str, set[str]] = {
    "reasoning": {"chain_of_thought", "tree_of_thoughts", "self_consistency", "step_back", "least_to_most"},
    "structure": {"structured_output", "constraints_prompting", "few_shot"},
    "role": {"role_prompting", "meta_prompting"},
    "knowledge": {"generated_knowledge", "react_prompting"},
    "creative": {"negative_prompting"},
}

_TECHNIQUE_TO_FAMILY: dict[str, str] = {}
for _fam, _ids in TECHNIQUE_FAMILIES.items():
    for _tid in _ids:
        _TECHNIQUE_TO_FAMILY[_tid] = _fam

# ---------------------------------------------------------------------------
# Anti-synergy pairs — penalise selecting both together
# ---------------------------------------------------------------------------
ANTI_SYNERGY: list[tuple[str, str]] = [
    ("chain_of_thought", "tree_of_thoughts"),
    ("chain_of_thought", "self_consistency"),
    ("tree_of_thoughts", "self_consistency"),
    ("structured_output", "few_shot"),
]

# ---------------------------------------------------------------------------
# Compatibility matrix: classifier task_type -> technique relevance (0.0–1.0)
# Bridges the gap between classifier labels and YAML when_to_use.task_types
# ---------------------------------------------------------------------------
TASK_TECHNIQUE_SCORES: dict[str, dict[str, float]] = {
    "code": {
        "role_prompting": 0.9, "chain_of_thought": 0.7, "structured_output": 0.8,
        "constraints_prompting": 0.7, "least_to_most": 0.6, "step_back": 0.4,
        "negative_prompting": 0.5, "few_shot": 0.4, "meta_prompting": 0.5,
        "react_prompting": 0.3, "generated_knowledge": 0.2, "tree_of_thoughts": 0.3,
        "self_consistency": 0.2,
    },
    "analysis": {
        "role_prompting": 0.8, "chain_of_thought": 0.9, "structured_output": 0.7,
        "constraints_prompting": 0.6, "step_back": 0.7, "tree_of_thoughts": 0.6,
        "self_consistency": 0.5, "generated_knowledge": 0.6, "least_to_most": 0.5,
        "meta_prompting": 0.5, "negative_prompting": 0.4, "few_shot": 0.3,
        "react_prompting": 0.3,
    },
    "creative": {
        "role_prompting": 0.9, "negative_prompting": 0.7, "constraints_prompting": 0.6,
        "generated_knowledge": 0.5, "few_shot": 0.4, "meta_prompting": 0.3,
        "chain_of_thought": 0.2, "structured_output": 0.2, "step_back": 0.2,
        "least_to_most": 0.1, "tree_of_thoughts": 0.1, "self_consistency": 0.1,
        "react_prompting": 0.1,
    },
    "writing": {
        "role_prompting": 0.9, "constraints_prompting": 0.8, "negative_prompting": 0.7,
        "structured_output": 0.4, "few_shot": 0.5, "generated_knowledge": 0.5,
        "chain_of_thought": 0.3, "meta_prompting": 0.4, "step_back": 0.2,
        "least_to_most": 0.2, "tree_of_thoughts": 0.1, "self_consistency": 0.1,
        "react_prompting": 0.1,
    },
    "structured_output": {
        "structured_output": 0.95, "few_shot": 0.8, "constraints_prompting": 0.7,
        "role_prompting": 0.5, "negative_prompting": 0.4, "chain_of_thought": 0.3,
        "meta_prompting": 0.2, "least_to_most": 0.2, "step_back": 0.1,
        "generated_knowledge": 0.1, "tree_of_thoughts": 0.1, "self_consistency": 0.1,
        "react_prompting": 0.1,
    },
    "transformation": {
        "constraints_prompting": 0.8, "few_shot": 0.8, "role_prompting": 0.6,
        "negative_prompting": 0.5, "structured_output": 0.5, "chain_of_thought": 0.3,
        "meta_prompting": 0.2, "least_to_most": 0.2, "step_back": 0.1,
        "generated_knowledge": 0.2, "tree_of_thoughts": 0.1, "self_consistency": 0.1,
        "react_prompting": 0.1,
    },
    "instruction": {
        "least_to_most": 0.8, "role_prompting": 0.7, "chain_of_thought": 0.7,
        "constraints_prompting": 0.6, "structured_output": 0.5, "negative_prompting": 0.5,
        "meta_prompting": 0.4, "few_shot": 0.3, "step_back": 0.3,
        "generated_knowledge": 0.2, "tree_of_thoughts": 0.2, "self_consistency": 0.2,
        "react_prompting": 0.2,
    },
    "debugging": {
        "chain_of_thought": 0.9, "role_prompting": 0.8, "step_back": 0.7,
        "least_to_most": 0.6, "structured_output": 0.5, "constraints_prompting": 0.4,
        "negative_prompting": 0.4, "react_prompting": 0.4, "meta_prompting": 0.3,
        "tree_of_thoughts": 0.3, "self_consistency": 0.3, "few_shot": 0.2,
        "generated_knowledge": 0.2,
    },
    "decision_making": {
        "chain_of_thought": 0.9, "self_consistency": 0.8, "tree_of_thoughts": 0.7,
        "role_prompting": 0.7, "step_back": 0.6, "generated_knowledge": 0.5,
        "constraints_prompting": 0.4, "structured_output": 0.4, "meta_prompting": 0.4,
        "negative_prompting": 0.3, "least_to_most": 0.3, "few_shot": 0.2,
        "react_prompting": 0.3,
    },
    "research": {
        "generated_knowledge": 0.8, "chain_of_thought": 0.7, "role_prompting": 0.7,
        "step_back": 0.7, "tree_of_thoughts": 0.5, "self_consistency": 0.5,
        "structured_output": 0.5, "meta_prompting": 0.4, "constraints_prompting": 0.3,
        "react_prompting": 0.4, "least_to_most": 0.4, "negative_prompting": 0.2,
        "few_shot": 0.2,
    },
    "data_analysis": {
        "structured_output": 0.9, "chain_of_thought": 0.7, "role_prompting": 0.7,
        "constraints_prompting": 0.5, "few_shot": 0.5, "step_back": 0.4,
        "least_to_most": 0.4, "negative_prompting": 0.3, "meta_prompting": 0.3,
        "generated_knowledge": 0.3, "tree_of_thoughts": 0.2, "self_consistency": 0.2,
        "react_prompting": 0.2,
    },
    "general": {
        "role_prompting": 0.7, "constraints_prompting": 0.5, "structured_output": 0.4,
        "chain_of_thought": 0.4, "negative_prompting": 0.3, "few_shot": 0.3,
        "least_to_most": 0.2, "meta_prompting": 0.2, "step_back": 0.2,
        "generated_knowledge": 0.2, "tree_of_thoughts": 0.1, "self_consistency": 0.1,
        "react_prompting": 0.1,
    },
    "image_generation": {
        "negative_prompting": 0.95, "constraints_prompting": 0.8, "structured_output": 0.7,
        "role_prompting": 0.5, "few_shot": 0.4, "chain_of_thought": 0.1,
        "meta_prompting": 0.1, "least_to_most": 0.1, "step_back": 0.0,
        "generated_knowledge": 0.1, "tree_of_thoughts": 0.0, "self_consistency": 0.0,
        "react_prompting": 0.0,
    },
}

# Complexity multipliers: technique_id -> {complexity: multiplier}
COMPLEXITY_MULTIPLIER: dict[str, dict[str, float]] = {
    "tree_of_thoughts": {"low": 0.0, "medium": 0.3, "high": 1.0},
    "self_consistency": {"low": 0.0, "medium": 0.2, "high": 1.0},
    "meta_prompting": {"low": 0.3, "medium": 0.7, "high": 1.0},
    "react_prompting": {"low": 0.0, "medium": 0.3, "high": 1.0},
    "step_back": {"low": 0.2, "medium": 0.7, "high": 1.0},
    "generated_knowledge": {"low": 0.2, "medium": 0.7, "high": 1.0},
    "least_to_most": {"low": 0.3, "medium": 0.8, "high": 1.0},
}


# ---------------------------------------------------------------------------
# Input feature extraction
# ---------------------------------------------------------------------------
_STEP_PATTERNS = re.compile(
    r"(по шагам|пошагов|step.by.step|пошаговая|шаг за шагом|step by step)", re.I
)
_EXAMPLE_PATTERNS = re.compile(r"(пример|example|например|e\.g\.|вот так|for instance)", re.I)
_AVOID_PATTERNS = re.compile(r"(не делай|не добавляй|не нужно|avoid|don.?t|без |исключи)", re.I)
_COMPARE_PATTERNS = re.compile(
    r"(сравни|варианты|альтернатив|compare|pros.and.cons|плюсы и минусы|что лучше|или)", re.I
)
_TABLE_PATTERNS = re.compile(r"(таблиц|json|xml|csv|yaml|markdown|формат)", re.I)
_IMAGE_PATTERNS = re.compile(
    r"(фото|картин|изображен|midjourney|dall-?e|stable.diffusion|визуал|иллюстрац|рисун|image.prompt|"
    r"генерац.*фото|генерац.*картин|промпт.*фото|промпт.*картин|photo.prompt)", re.I,
)
_SKILL_PATTERNS = re.compile(
    r"(создай скилл|skill.for|навык для|create a skill|generate skill|скилл|agent skill)", re.I
)


def extract_input_features(user_input: str) -> dict[str, bool]:
    """Extract rich boolean features from user input for technique boosting."""
    return {
        "has_examples": bool(_EXAMPLE_PATTERNS.search(user_input)),
        "asks_step_by_step": bool(_STEP_PATTERNS.search(user_input)),
        "has_avoid_constraints": bool(_AVOID_PATTERNS.search(user_input)),
        "asks_comparison": bool(_COMPARE_PATTERNS.search(user_input)),
        "wants_structured": bool(_TABLE_PATTERNS.search(user_input)),
        "has_code_block": bool(re.search(r"```|def |class |import |function ", user_input)),
        "is_short": len(user_input.split()) < 12,
        "is_long_detailed": len(user_input.split()) > 80,
        "is_image_prompt": bool(_IMAGE_PATTERNS.search(user_input)),
        "is_skill_request": bool(_SKILL_PATTERNS.search(user_input)),
    }


FEATURE_BOOSTS: dict[str, dict[str, float]] = {
    "has_examples": {"few_shot": 0.25},
    "asks_step_by_step": {"chain_of_thought": 0.3, "least_to_most": 0.2},
    "has_avoid_constraints": {"negative_prompting": 0.3, "constraints_prompting": 0.15},
    "asks_comparison": {"self_consistency": 0.25, "tree_of_thoughts": 0.2},
    "wants_structured": {"structured_output": 0.3, "few_shot": 0.15},
    "has_code_block": {"chain_of_thought": 0.1, "structured_output": 0.1},
    "is_short": {"role_prompting": 0.1},
    "is_long_detailed": {"meta_prompting": 0.15, "least_to_most": 0.1},
    "is_image_prompt": {"negative_prompting": 0.4, "constraints_prompting": 0.2, "structured_output": 0.15},
    "is_skill_request": {"role_prompting": 0.2, "constraints_prompting": 0.2, "meta_prompting": 0.15},
}


# ---------------------------------------------------------------------------
# Scoring engine
# ---------------------------------------------------------------------------

def _base_relevance(technique_id: str, task_types: list[str]) -> float:
    """Average relevance score across all detected task types."""
    if not task_types:
        task_types = ["general"]
    total = 0.0
    for tt in task_types:
        scores = TASK_TECHNIQUE_SCORES.get(tt, TASK_TECHNIQUE_SCORES["general"])
        total += scores.get(technique_id, 0.05)
    return total / len(task_types)


def _complexity_factor(technique_id: str, complexity: str) -> float:
    """Returns a multiplier (0.0–1.0) based on technique-complexity fit."""
    mults = COMPLEXITY_MULTIPLIER.get(technique_id)
    if mults is None:
        return 1.0
    return mults.get(complexity, 0.7)


def _feature_boost(technique_id: str, features: dict[str, bool]) -> float:
    """Sum of boost values for active features."""
    total = 0.0
    for feat, active in features.items():
        if active and feat in FEATURE_BOOSTS:
            total += FEATURE_BOOSTS[feat].get(technique_id, 0.0)
    return total


def _synergy_bonus(technique_id: str, already_selected: list[str], techniques_data: dict[str, Any]) -> float:
    """Bonus if combines_well_with any already-selected technique."""
    tech = techniques_data.get(technique_id, {})
    compat = tech.get("compatibility", {})
    combines = set(compat.get("combines_well_with", []))
    if not combines:
        return 0.0
    overlap = combines & set(already_selected)
    return 0.08 * len(overlap)


def _anti_synergy_penalty(technique_id: str, already_selected: list[str]) -> float:
    """Penalty if technique conflicts with an already-selected one."""
    penalty = 0.0
    sel_set = set(already_selected)
    for a, b in ANTI_SYNERGY:
        if technique_id == a and b in sel_set:
            penalty += 0.3
        elif technique_id == b and a in sel_set:
            penalty += 0.3
    return penalty


def _family_slot_available(technique_id: str, family_counts: dict[str, int], complexity: str) -> bool:
    """Check whether the technique's family still has slots."""
    fam = _TECHNIQUE_TO_FAMILY.get(technique_id)
    if fam is None:
        return True
    limit = 2 if (fam == "reasoning" and complexity == "high") else 1
    return family_counts.get(fam, 0) < limit


def _effective_task_types_for_prompt_mode(task_types: list[str], prompt_type: str) -> list[str]:
    """Bias classifier labels toward image / skill generation when the UI mode demands it."""
    tt = list(task_types) if task_types else ["general"]
    if prompt_type == "image":
        if "image_generation" not in tt:
            return ["image_generation", *tt]
    if prompt_type == "skill":
        merged = ["instruction", "writing"]
        for x in tt:
            if x not in merged:
                merged.append(x)
        return merged[:6]
    return tt


def _prompt_type_score_multiplier(technique_id: str, prompt_type: str) -> float:
    """Per-mode emphasis so the same heuristic input yields different technique sets."""
    if prompt_type == "image":
        m = {
            "negative_prompting": 1.38,
            "constraints_prompting": 1.22,
            "structured_output": 1.18,
            "few_shot": 1.12,
            "role_prompting": 1.05,
            "chain_of_thought": 0.38,
            "tree_of_thoughts": 0.25,
            "self_consistency": 0.28,
            "react_prompting": 0.2,
            "generated_knowledge": 0.45,
            "least_to_most": 0.55,
            "step_back": 0.5,
            "meta_prompting": 0.75,
        }
        return m.get(technique_id, 0.88)
    if prompt_type == "skill":
        m = {
            "role_prompting": 1.28,
            "meta_prompting": 1.22,
            "constraints_prompting": 1.18,
            "structured_output": 1.15,
            "few_shot": 1.12,
            "chain_of_thought": 0.85,
            "negative_prompting": 0.62,
            "tree_of_thoughts": 0.75,
            "self_consistency": 0.72,
        }
        return m.get(technique_id, 1.0)
    # text / default
    return 1.0


def select_techniques_scored(
    task_types: list[str],
    complexity: str,
    user_input: str,
    techniques_data: dict[str, dict[str, Any]],
    *,
    max_techniques: int = 4,
    target_model: str = "unknown",
    prompt_type: str = "text",
) -> list[dict[str, Any]]:
    """
    Score-based technique selection with family quotas, synergy, and input features.
    Returns a list of technique dicts (from the registry) sorted by score.
    """
    from core.technique_registry import AVOID_ON_SMALL_MODELS

    eff_types = _effective_task_types_for_prompt_mode(task_types, prompt_type)
    features = extract_input_features(user_input)
    is_small = target_model == "small_model"

    candidates: list[tuple[float, str]] = []
    for tid, tech in techniques_data.items():
        if is_small and tid in AVOID_ON_SMALL_MODELS:
            continue
        base = _base_relevance(tid, eff_types)
        cx = _complexity_factor(tid, complexity)
        fb = _feature_boost(tid, features)
        pm = _prompt_type_score_multiplier(tid, prompt_type)
        score = (base * cx + fb) * pm
        candidates.append((score, tid))

    candidates.sort(key=lambda x: -x[0])

    selected: list[str] = []
    family_counts: dict[str, int] = {}

    for score, tid in candidates:
        if len(selected) >= max_techniques:
            break
        if not _family_slot_available(tid, family_counts, complexity):
            continue

        syn = _synergy_bonus(tid, selected, techniques_data)
        anti = _anti_synergy_penalty(tid, selected)
        final_score = score + syn - anti

        if final_score < 0.15:
            continue

        selected.append(tid)
        fam = _TECHNIQUE_TO_FAMILY.get(tid)
        if fam:
            family_counts[fam] = family_counts.get(fam, 0) + 1

    if not selected:
        for fallback in ["role_prompting", "constraints_prompting", "structured_output"]:
            if fallback in techniques_data and (not is_small or fallback not in AVOID_ON_SMALL_MODELS):
                selected.append(fallback)
                if len(selected) >= max_techniques:
                    break

    return [techniques_data[tid] for tid in selected if tid in techniques_data]
