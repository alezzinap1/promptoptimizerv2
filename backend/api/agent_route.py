"""Agent routing and processing — smart agent brain with prompt type awareness."""
from __future__ import annotations

import random

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from backend.deps import get_current_user
from config.settings import (
    PRE_PROMPT_MIN_CONFIDENCE,
    PRE_PROMPT_MIN_MARGIN,
    SEMANTIC_ROUTE_MIN_CONFIDENCE,
    SEMANTIC_ROUTE_MIN_MARGIN,
)
from core.agent_followup_rules import resolve_has_prompt_action
from core.pre_prompt_gate import (
    pre_prompt_rules_force_task,
    pre_prompt_rules_meta_chat,
    substantive_skill_request,
)
from core.suggested_actions import build_suggested_actions
from core.task_classifier import classify_task, detect_prompt_type
from core.technique_synergy import extract_input_features
from services.semantic_agent_router import route_intent, route_pre_prompt_intent

PRE_PROMPT_META_MESSAGES = [
    "Похоже, это пока **разговор** или общее намерение без конкретной задачи. Когда опишете, что должна делать модель и в каком виде нужен ответ — я запущу сборку промпта справа.",
    "Определил намерение как **диалог**: генерацию пока не запускаю. Напишите задачу конкретнее (цель, формат, ограничения) — и продолжим.",
    "Сейчас это больше похоже на **приветствие или уточнение**, чем на формулировку задачи. Опишите, что нужно получить от модели — начнём генерацию.",
]

router = APIRouter()


def _pick_pre_meta_message() -> str:
    return random.choice(PRE_PROMPT_META_MESSAGES)


def _resolve_pre_prompt_branch(text: str, route_result: dict) -> str:
    """Возвращает meta | task."""
    intent = route_result.get("intent")
    conf = float(route_result.get("confidence") or 0.0)
    margin = float(route_result.get("margin") or 0.0)
    backend = str(route_result.get("backend") or "")
    wc = len(text.split())
    if backend in ("unavailable", "error", "skip") or not intent:
        return "task" if wc >= 14 else "meta"
    if conf < PRE_PROMPT_MIN_CONFIDENCE or margin < PRE_PROMPT_MIN_MARGIN:
        return "task" if wc >= 14 else "meta"
    if intent == "pre_meta":
        return "meta"
    return "task"


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

    prompt_type = str(req.prompt_type or detect_prompt_type(text) or "text")

    if req.has_prompt:
        classification = classify_task(text)
        route_result = route_intent(text, has_prompt=True)
        out = resolve_has_prompt_action(text, prompt_type, route_result)
        return _attach_suggested_actions_for_has_prompt(out, req, prompt_type)

    # ── Пре-промпт: без тяжёлого LLM, правила + один эмбеддинг при необходимости ──
    if pre_prompt_rules_meta_chat(text):
        return {
            "action": "chat",
            "data": {"message": _pick_pre_meta_message()},
            "reasoning": "pre_prompt:rules_meta_chat",
        }

    route_pre: dict = {"backend": "force_task"}
    if pre_prompt_rules_force_task(text):
        branch = "task"
    else:
        route_pre = route_pre_prompt_intent(text)
        branch = _resolve_pre_prompt_branch(text, route_pre)

    if branch == "meta":
        return {
            "action": "chat",
            "data": {"message": _pick_pre_meta_message()},
            "reasoning": f"pre_prompt:semantic_meta intent={route_pre.get('intent')} "
            f"conf={route_pre.get('confidence')} margin={route_pre.get('margin')}",
        }

    classification = classify_task(text)
    features = extract_input_features(text)

    if prompt_type == "skill" and substantive_skill_request(text):
        return {
            "action": "generate_skill",
            "data": {"description": text, "prompt_type": "skill"},
            "reasoning": "pre_prompt:task_branch substantive_skill",
            "classification": classification,
            "features": features,
            "router_trace": route_pre,
        }

    complexity_tier = _select_model_tier(classification["complexity"])

    return {
        "action": "generate",
        "data": {
            "task_input": text,
            "prompt_type": prompt_type,
            "model_tier": complexity_tier,
        },
        "reasoning": f"pre_prompt:task_branch new_prompt type={prompt_type} complexity={classification['complexity']}",
        "classification": classification,
        "features": features,
        "router_trace": route_pre,
    }


def _select_model_tier(complexity: str) -> str:
    """Select cost-appropriate model tier based on complexity."""
    if complexity == "low":
        return "tier1"
    if complexity == "high":
        return "tier3"
    return "tier2"
