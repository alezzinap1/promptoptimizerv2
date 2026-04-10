"""Agent routing and processing — smart agent brain with prompt type awareness."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from backend.deps import get_current_user
from config.settings import SEMANTIC_ROUTE_MIN_CONFIDENCE, SEMANTIC_ROUTE_MIN_MARGIN
from core.agent_followup_rules import resolve_has_prompt_action
from core.suggested_actions import build_suggested_actions
from core.task_classifier import classify_task, detect_prompt_type
from core.technique_synergy import extract_input_features
from services.semantic_agent_router import route_intent

router = APIRouter()


def _attach_suggested_actions_for_has_prompt(body: dict, req: AgentProcessRequest, prompt_type: str) -> dict:
    actions = build_suggested_actions(
        has_prompt=True,
        prompt_type=prompt_type or "text",
        current_prompt=req.current_prompt,
        metrics=None,
    )
    return {**body, "suggested_actions": actions}


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


class AgentChatHistoryItem(BaseModel):
    role: str = Field(..., max_length=32)
    content: str = Field("", max_length=16000)


class AgentProcessRequest(BaseModel):
    text: str = Field("", max_length=8000)
    session_id: str | None = None
    has_prompt: bool = False
    prompt_type: str | None = None
    current_prompt: str | None = None
    """Last N chat turns; optional, no server-side persistence (P0)."""
    chat_history: list[AgentChatHistoryItem] | None = None


@router.post("/agent/process")
def agent_process(
    req: AgentProcessRequest,
    _user: dict = Depends(get_current_user),
):
    """
    Smart agent brain: classifies user input, detects prompt type,
    plans the best action, and returns structured instructions for the frontend.

    Actions: generate, iterate, eval_prompt, save_library, show_versions,
    nav_compare, nav_library, nav_skills, chat, generate_skill
    """
    text = req.text.strip()
    if not text:
        return {
            "action": "chat",
            "data": {"message": "Опишите задачу для создания промпта."},
            "reasoning": "empty_input",
        }

    prompt_type = req.prompt_type or detect_prompt_type(text)
    classification = classify_task(text)
    features = extract_input_features(text)

    if req.has_prompt:
        route_result = route_intent(text, has_prompt=True)
        out = resolve_has_prompt_action(text, prompt_type, route_result)
        return _attach_suggested_actions_for_has_prompt(out, req, prompt_type)

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
