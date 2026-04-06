"""
Shared helpers for prompt preview and generation flows.
"""
from __future__ import annotations

import inspect

from core.evidence import build_evidence_map
from core.intent_graph import build_intent_graph
from core.model_taxonomy import ModelType, classify_model, SUPPRESS_FOR_REASONING
from core.prompt_debugger import analyze_prompt_spec
from core.prompt_spec import build_prompt_spec
from core.task_classifier import classify_task
from core.technique_registry import TechniqueRegistry

_BUILD_PROMPT_SPEC_ACCEPTS_OVERRIDES = "overrides" in inspect.signature(build_prompt_spec).parameters


def parse_lines(value: str | list[str] | None) -> list[str]:
    if not value:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [line.strip() for line in value.splitlines() if line.strip()]


def build_prompt_spec_with_overrides(
    raw_input: str,
    classification: dict,
    target_model: str,
    workspace: dict | None,
    previous_prompt: str | None,
    overrides: dict | None,
) -> dict:
    if _BUILD_PROMPT_SPEC_ACCEPTS_OVERRIDES:
        return build_prompt_spec(
            raw_input=raw_input,
            classification=classification,
            target_model=target_model,
            workspace=workspace,
            previous_prompt=previous_prompt,
            overrides=overrides,
        )

    spec = build_prompt_spec(
        raw_input=raw_input,
        classification=classification,
        target_model=target_model,
        workspace=workspace,
        previous_prompt=previous_prompt,
    )
    overrides = overrides or {}
    if overrides.get("audience"):
        spec["audience"] = str(overrides["audience"]).strip() or None
    if overrides.get("output_format"):
        spec["output_format"] = overrides["output_format"]
    for key in ("constraints", "source_of_truth", "success_criteria"):
        val = overrides.get(key)
        if val is not None:
            spec[key] = parse_lines(val)
    return spec


def apply_evidence_decisions(overrides: dict | None, decisions: dict | None) -> dict:
    result = dict(overrides or {})
    for key in ("constraints", "source_of_truth", "success_criteria"):
        result[key] = parse_lines(result.get(key))
    if "audience" in result:
        result["audience"] = str(result.get("audience") or "").strip()
    if "output_format" in result:
        result["output_format"] = str(result.get("output_format") or "").strip()

    for field, decision in (decisions or {}).items():
        if decision == "reject":
            result[field] = [] if field in ("constraints", "source_of_truth", "success_criteria") else ""
    return result


def resolve_techniques(
    registry: TechniqueRegistry,
    classification: dict,
    target_model: str,
    technique_mode: str,
    manual_techs: list[str],
    max_techniques: int = 4,
    user_input: str = "",
    prompt_type: str = "text",
    recent_technique_ids: list[str] | None = None,
) -> list[dict]:
    task_types = classification["task_types"]
    complexity = classification["complexity"]
    if technique_mode == "manual" and manual_techs:
        selected = [t for t in (registry.get(tid) for tid in manual_techs) if t]
    else:
        selected = registry.select_techniques(
            task_types, complexity, max_techniques=max_techniques,
            target_model=target_model, user_input=user_input,
            prompt_type=prompt_type or "text",
            recent_technique_ids=recent_technique_ids,
        )

    model_type = classify_model(target_model)
    if model_type == ModelType.REASONING and technique_mode != "manual":
        selected = [t for t in selected if t["id"] not in SUPPRESS_FOR_REASONING]

    return selected


def build_preview_payload(
    raw_input: str,
    target_model: str,
    workspace: dict | None,
    previous_prompt: str | None,
    overrides: dict | None,
    registry: TechniqueRegistry,
    technique_mode: str = "auto",
    manual_techs: list[str] | None = None,
    classification_override: dict | None = None,
    prompt_type: str = "text",
) -> dict:
    classification = classification_override if classification_override is not None else classify_task(raw_input)
    techniques = resolve_techniques(
        registry=registry,
        classification=classification,
        target_model=target_model,
        technique_mode=technique_mode,
        manual_techs=manual_techs or [],
        max_techniques=4,
        user_input=raw_input,
        prompt_type=prompt_type or "text",
    )
    prompt_spec = build_prompt_spec_with_overrides(
        raw_input=raw_input,
        classification=classification,
        target_model=target_model,
        workspace=workspace,
        previous_prompt=previous_prompt,
        overrides=overrides,
    )
    evidence = build_evidence_map(prompt_spec, raw_input, workspace)
    issues = analyze_prompt_spec(prompt_spec)
    intent_graph = build_intent_graph(prompt_spec)
    return {
        "classification": classification,
        "techniques": [{"id": t["id"], "name": t.get("name", t["id"])} for t in techniques],
        "prompt_spec": prompt_spec,
        "evidence": evidence,
        "debug_issues": issues,
        "intent_graph": intent_graph,
    }
