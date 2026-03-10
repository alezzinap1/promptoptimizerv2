"""Prompt generation."""
from __future__ import annotations

import os
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.context_builder import ContextBuilder
from core.domain_templates import get_domain_techniques
from core.parsing import parse_reply
from core.quality_metrics import analyze_prompt
from core.task_classifier import classify_task
from core.technique_registry import TechniqueRegistry
from db.manager import DBManager
from services.llm_client import LLMClient, DEFAULT_PROVIDER

router = APIRouter()


def get_llm() -> LLMClient:
    api_key = os.getenv("OPENROUTER_API_KEY", "")
    if not api_key:
        raise HTTPException(500, "OPENROUTER_API_KEY not set")
    return LLMClient(api_key)


def get_db() -> DBManager:
    db = DBManager()
    db.init()
    return db


def get_registry() -> TechniqueRegistry:
    return TechniqueRegistry()


class GenerateRequest(BaseModel):
    task_input: str
    feedback: str = ""
    gen_model: str = DEFAULT_PROVIDER
    target_model: str = "unknown"
    domain: str = "auto"
    technique_mode: str = "auto"
    manual_techs: list[str] = []
    temperature: float = 0.7
    top_p: float | None = 1.0
    top_k: int | None = None
    questions_mode: bool = True
    session_id: str | None = None
    previous_prompt: str | None = None


def _run_generation(
    task_input: str,
    feedback: str,
    gen_model: str,
    target_model: str,
    domain: str,
    technique_mode: str,
    manual_techs: list[str],
    temperature: float,
    top_p: float | None,
    top_k: int | None,
    questions_mode: bool,
    previous_prompt: str | None,
    session_id: str,
    llm: LLMClient,
    db: DBManager,
    registry: TechniqueRegistry,
) -> dict:
    classification = classify_task(task_input)
    task_types = classification["task_types"]
    complexity = classification["complexity"]

    if technique_mode == "manual" and manual_techs:
        techniques = [t for t in (registry.get(tid) for tid in manual_techs) if t]
    elif domain and domain != "auto":
        domain_tech_ids = get_domain_techniques(domain)
        if domain_tech_ids:
            techniques = [t for t in (registry.get(tid) for tid in domain_tech_ids) if t]
        else:
            techniques = registry.select_techniques(
                task_types, complexity, max_techniques=4, target_model=target_model
            )
    else:
        techniques = registry.select_techniques(
            task_types, complexity, max_techniques=4, target_model=target_model
        )

    technique_ids = [t["id"] for t in techniques]
    builder = ContextBuilder(registry)

    combined_input = task_input
    if feedback.strip():
        combined_input += f"\n\nКомментарий к улучшению: {feedback}"

    system_prompt = builder.build_system_prompt(
        technique_ids=technique_ids,
        target_model=target_model,
        domain=domain or "auto",
        questions_mode=questions_mode,
    )
    user_content = builder.build_user_content(
        combined_input,
        previous_agent_prompt=previous_prompt,
        task_classification=classification,
    )

    full_text = ""
    for chunk in llm.stream(
        system_prompt, user_content, gen_model, temperature,
        top_p=top_p, top_k=top_k,
    ):
        full_text += chunk

    parsed = parse_reply(full_text)
    metrics = analyze_prompt(parsed.get("prompt_block", "")) if parsed.get("has_prompt") else {}

    if parsed.get("has_prompt"):
        db.save_prompt_version(
            session_id=session_id,
            task_input=task_input,
            task_types=task_types,
            complexity=complexity,
            target_model=target_model,
            gen_model=gen_model,
            techniques_used=technique_ids,
            reasoning=parsed.get("reasoning", ""),
            final_prompt=parsed["prompt_block"],
            metrics=metrics,
        )

    return {
        **parsed,
        "techniques": [{"id": t["id"], "name": t.get("name", t["id"])} for t in techniques],
        "technique_ids": technique_ids,
        "task_types": task_types,
        "complexity": complexity,
        "gen_model": gen_model,
        "target_model": target_model,
        "metrics": metrics,
    }


@router.post("/generate")
def generate_prompt(req: GenerateRequest):
    """Generate prompt. Returns full result (LLM call is blocking)."""
    session_id = req.session_id or str(uuid.uuid4())
    try:
        llm = get_llm()
    except HTTPException:
        raise
    db = get_db()
    db.init()
    registry = get_registry()

    result = _run_generation(
        task_input=req.task_input,
        feedback=req.feedback,
        gen_model=req.gen_model,
        target_model=req.target_model,
        domain=req.domain,
        technique_mode=req.technique_mode,
        manual_techs=req.manual_techs,
        temperature=req.temperature,
        top_p=req.top_p,
        top_k=req.top_k,
        questions_mode=req.questions_mode,
        previous_prompt=req.previous_prompt,
        session_id=session_id,
        llm=llm,
        db=db,
        registry=registry,
    )
    result["session_id"] = session_id
    return result
