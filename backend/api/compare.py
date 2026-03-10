"""A/B Compare — generate with two technique sets."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.context_builder import ContextBuilder
from core.parsing import parse_reply
from core.quality_metrics import analyze_prompt
from core.task_classifier import classify_task
from core.technique_registry import TechniqueRegistry
from services.llm_client import LLMClient, DEFAULT_PROVIDER

router = APIRouter()

import os


def get_llm() -> LLMClient:
    api_key = os.getenv("OPENROUTER_API_KEY", "")
    if not api_key:
        raise HTTPException(500, "OPENROUTER_API_KEY not set")
    return LLMClient(api_key)


def get_registry() -> TechniqueRegistry:
    return TechniqueRegistry()


class CompareRequest(BaseModel):
    task_input: str
    gen_model: str = DEFAULT_PROVIDER
    target_model: str = "unknown"
    temperature: float = 0.7
    top_p: float | None = 1.0
    techs_a_mode: str = "auto"
    techs_a_manual: list[str] = []
    techs_b_mode: str = "auto"
    techs_b_manual: list[str] = []


@router.post("/compare")
def compare_prompts(req: CompareRequest):
    """Generate two prompts with different technique sets and return both."""
    llm = get_llm()
    registry = get_registry()
    builder = ContextBuilder(registry)

    classification = classify_task(req.task_input)
    task_types = classification["task_types"]
    complexity = classification["complexity"]

    def resolve_techs(mode: str, manual: list[str]) -> list:
        if mode == "manual" and manual:
            return [t for t in (registry.get(tid) for tid in manual) if t]
        return registry.select_techniques(task_types, complexity, 3, req.target_model)

    techniques_a = resolve_techs(req.techs_a_mode, req.techs_a_manual)
    techniques_b = resolve_techs(req.techs_b_mode, req.techs_b_manual)
    ids_a = [t["id"] for t in techniques_a]
    ids_b = [t["id"] for t in techniques_b]

    user_content = builder.build_user_content(req.task_input, task_classification=classification)

    # Generate A
    system_a = builder.build_system_prompt(technique_ids=ids_a, target_model=req.target_model)
    result_a_text = ""
    for chunk in llm.stream(system_a, user_content, req.gen_model, req.temperature, top_p=req.top_p):
        result_a_text += chunk

    # Generate B
    system_b = builder.build_system_prompt(technique_ids=ids_b, target_model=req.target_model)
    result_b_text = ""
    for chunk in llm.stream(system_b, user_content, req.gen_model, req.temperature, top_p=req.top_p):
        result_b_text += chunk

    parsed_a = parse_reply(result_a_text)
    parsed_b = parse_reply(result_b_text)
    prompt_a = parsed_a.get("prompt_block") or result_a_text
    prompt_b = parsed_b.get("prompt_block") or result_b_text

    metrics_a = analyze_prompt(prompt_a)
    metrics_b = analyze_prompt(prompt_b)

    return {
        "a": {
            "prompt": prompt_a,
            "reasoning": parsed_a.get("reasoning", ""),
            "techniques": [{"id": t["id"], "name": t.get("name", t["id"])} for t in techniques_a],
            "metrics": metrics_a,
        },
        "b": {
            "prompt": prompt_b,
            "reasoning": parsed_b.get("reasoning", ""),
            "techniques": [{"id": t["id"], "name": t.get("name", t["id"])} for t in techniques_b],
            "metrics": metrics_b,
        },
    }
