"""Agent routing and processing — smart agent brain with prompt type awareness."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from backend.deps import get_current_user
from config.settings import SEMANTIC_ROUTE_MIN_CONFIDENCE, SEMANTIC_ROUTE_MIN_MARGIN
from core.task_classifier import classify_task, detect_prompt_type
from core.technique_synergy import extract_input_features
from services.semantic_agent_router import route_intent

router = APIRouter()


class SemanticRouteRequest(BaseModel):
    text: str = Field("", max_length=4000)
    has_prompt: bool = True


@router.post("/agent/semantic-route")
def semantic_route(
    req: SemanticRouteRequest,
    _user: dict = Depends(get_current_user),
):
    out = route_intent(req.text, has_prompt=req.has_prompt)
    intent = out.get("intent")
    conf = float(out.get("confidence") or 0.0)
    margin = float(out.get("margin") or 0.0)
    if intent and (conf < SEMANTIC_ROUTE_MIN_CONFIDENCE or margin < SEMANTIC_ROUTE_MIN_MARGIN):
        out = {**out, "intent": None, "rejected_reason": "below_threshold"}
    return out


class AgentProcessRequest(BaseModel):
    text: str = Field("", max_length=8000)
    session_id: str | None = None
    has_prompt: bool = False
    prompt_type: str | None = None
    current_prompt: str | None = None


@router.post("/agent/process")
def agent_process(
    req: AgentProcessRequest,
    _user: dict = Depends(get_current_user),
):
    """
    Smart agent brain: classifies user input, detects prompt type,
    plans the best action, and returns structured instructions for the frontend.

    Actions: generate, iterate, evaluate, save_library, navigate, chat, generate_skill
    """
    text = req.text.strip()
    if not text:
        return {"action": "chat", "data": {"message": "Опишите задачу для создания промпта."}, "reasoning": "empty_input"}

    prompt_type = req.prompt_type or detect_prompt_type(text)
    classification = classify_task(text)
    features = extract_input_features(text)

    if req.has_prompt:
        route_result = route_intent(text, has_prompt=True)
        intent = route_result.get("intent")
        conf = float(route_result.get("confidence") or 0.0)
        margin = float(route_result.get("margin") or 0.0)
        if intent and (conf < SEMANTIC_ROUTE_MIN_CONFIDENCE or margin < SEMANTIC_ROUTE_MIN_MARGIN):
            intent = None

        if intent == "iterate":
            return {
                "action": "iterate",
                "data": {"feedback": text, "prompt_type": prompt_type},
                "reasoning": f"semantic_route: iterate (conf={conf:.2f})",
            }
        if intent == "save_library":
            return {"action": "save_library", "data": {}, "reasoning": "semantic_route: save_library"}
        if intent == "eval_prompt":
            return {"action": "evaluate", "data": {}, "reasoning": "semantic_route: eval_prompt"}
        if intent == "show_versions":
            return {"action": "show_versions", "data": {}, "reasoning": "semantic_route: show_versions"}
        if intent and intent.startswith("nav_"):
            return {"action": "navigate", "data": {"target": intent}, "reasoning": f"semantic_route: {intent}"}
        if intent == "chat":
            return {"action": "chat", "data": {"message": ""}, "reasoning": "semantic_route: chat"}

        return {
            "action": "iterate",
            "data": {"feedback": text, "prompt_type": prompt_type},
            "reasoning": "default_iterate_with_prompt",
        }

    if features.get("is_skill_request"):
        return {
            "action": "generate_skill",
            "data": {"description": text, "prompt_type": "skill"},
            "reasoning": "skill_creation_detected",
            "classification": classification,
        }

    complexity_tier = _select_model_tier(classification["complexity"])

    return {
        "action": "generate",
        "data": {
            "task_input": text,
            "prompt_type": prompt_type,
            "model_tier": complexity_tier,
        },
        "reasoning": f"new_prompt: type={prompt_type}, complexity={classification['complexity']}",
        "classification": classification,
        "features": features,
    }


def _select_model_tier(complexity: str) -> str:
    """Select cost-appropriate model tier based on complexity."""
    if complexity == "low":
        return "tier1"
    if complexity == "high":
        return "tier3"
    return "tier2"
