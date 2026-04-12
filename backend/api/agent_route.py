"""Agent routing and processing — smart agent brain with prompt type awareness."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from backend.deps import get_current_user, get_db
from config.settings import (
    AGENT_STUDIO_CHAT_LLM_ENABLED,
    AGENT_STUDIO_CHAT_PROVIDER,
    CHEAP_PRE_ROUTER_PROVIDER,
    PRE_PROMPT_LLM_ENABLED,
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
from db.manager import DBManager
from services.agent_studio_chat_reply import light_studio_chat_reply
from services.api_key_resolver import resolve_openrouter_api_key
from services.cheap_llm_pre_router import cheap_llm_pre_router
from services.llm_client import LLMClient
from services.semantic_agent_router import route_intent, route_pre_prompt_intent

logger = logging.getLogger(__name__)

FALLBACK_PRE_PROMPT_CHAT = (
    "Опишите задачу для промпта — соберу текст справа. Можно и просто поболтать: отвечу кратко, пока это не похоже на конкретную задачу."
)

router = APIRouter()


def _fallback_pre_prompt_chat_message() -> str:
    return FALLBACK_PRE_PROMPT_CHAT


def _pre_prompt_dialog_response(
    *,
    uid: int,
    db: DBManager,
    text: str,
    prompt_type: str,
    chat_history: list[AgentChatHistoryItem] | None,
    reasoning: str,
) -> dict:
    """Ответ при трактовке реплики как диалога до первого промпта — лёгкий LLM или короткий fallback."""
    msg = _fallback_pre_prompt_chat_message()
    hist = [
        {"role": h.role, "content": h.content}
        for h in (chat_history or [])
        if (h.content or "").strip()
    ]
    if AGENT_STUDIO_CHAT_LLM_ENABLED:
        user_key = db.get_user_openrouter_api_key(uid)
        api_key = resolve_openrouter_api_key(user_key)
        if api_key:
            try:
                client = LLMClient(api_key)
                prov = AGENT_STUDIO_CHAT_PROVIDER or CHEAP_PRE_ROUTER_PROVIDER
                got = light_studio_chat_reply(
                    client,
                    user_text=text,
                    prompt_type=prompt_type,
                    history=hist,
                    provider=prov,
                )
                if got:
                    msg = got
            except Exception as e:
                logger.warning("light_studio_chat_reply: %s", e)
    return {
        "action": "chat",
        "data": {"message": msg},
        "reasoning": reasoning,
    }


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
    expert_level: str | None = None
    """Пользователь нажал «Продолжить без уточнения» — пропустить пре-роутер."""
    force_task: bool = False
    router_log_id: int | None = None


def _normalize_expert_level(raw: str | None) -> str:
    k = (raw or "mid").lower().strip()
    if k in ("junior", "mid", "senior", "creative"):
        return k
    return "mid"


def _pre_prompt_task_branch(
    text: str,
    prompt_type: str,
    route_pre: dict,
    *,
    force_skill_tab: bool = False,
) -> dict:
    classification = classify_task(text)
    features = extract_input_features(text)
    llm_intent = str(route_pre.get("intent") or "")
    skill_from_llm = (
        prompt_type == "skill"
        and str(route_pre.get("backend") or "") == "cheap_llm"
        and llm_intent in ("generate_skill", "generate_prompt")
    )
    if prompt_type == "skill" and (substantive_skill_request(text) or force_skill_tab or skill_from_llm):
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


@router.post("/agent/process")
def agent_process(
    req: AgentProcessRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    """
    Smart agent brain: classifies user input, detects prompt type,
    plans the best action, and returns structured instructions for the frontend.

    Actions: generate, iterate, eval_prompt, save_library, show_versions,
    nav_compare, nav_library, nav_skills, chat, generate_skill
    """
    uid = int(user["id"])
    expert_level = _normalize_expert_level(req.expert_level)

    if req.force_task and req.router_log_id:
        try:
            db.mark_pre_router_override(uid, int(req.router_log_id))
        except Exception as e:
            logger.warning("mark_pre_router_override failed: %s", e)

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

    # ── Пре-промпт: правила → дешёвый LLM (флаг) → embeddings ──
    if req.force_task:
        return _pre_prompt_task_branch(
            text,
            prompt_type,
            {"backend": "force_task", "expert_level": expert_level},
            force_skill_tab=prompt_type == "skill",
        )

    if pre_prompt_rules_meta_chat(text):
        return _pre_prompt_dialog_response(
            uid=uid,
            db=db,
            text=text,
            prompt_type=prompt_type,
            chat_history=req.chat_history,
            reasoning="pre_prompt:rules_meta_chat",
        )

    route_pre: dict = {"backend": "force_task"}
    used_llm = False

    if pre_prompt_rules_force_task(text):
        pass  # branch task; route_pre остаётся force_task
    elif PRE_PROMPT_LLM_ENABLED:
        user_key = db.get_user_openrouter_api_key(uid)
        api_key = resolve_openrouter_api_key(user_key)
        if api_key:
            try:
                client = LLMClient(api_key)
                hist = [{"role": h.role, "content": h.content} for h in (req.chat_history or [])[-3:]]
                llm_out = cheap_llm_pre_router(
                    client,
                    text=text,
                    prompt_type=prompt_type,
                    history_last_3=hist,
                    provider=CHEAP_PRE_ROUTER_PROVIDER,
                    expert_level=expert_level,
                )
                log_id = db.insert_pre_router_log(
                    uid,
                    text,
                    prompt_type,
                    llm_out.get("intent"),
                    float(llm_out.get("confidence") or 0.0),
                    llm_out.get("reason"),
                    expert_level,
                )
                intent = str(llm_out.get("intent") or "")
                reply = str(llm_out.get("reply") or "").strip()
                reason = str(llm_out.get("reason") or "").strip()

                if intent == "clarify":
                    return {
                        "action": "chat",
                        "data": {"message": reply or "Уточните детали задачи."},
                        "is_clarification": True,
                        "clarify_reason": reason,
                        "router_log_id": log_id,
                        "reasoning": "pre_prompt:cheap_llm_clarify",
                        "router_trace": {**llm_out, "backend": "cheap_llm"},
                    }
                if intent == "chat":
                    out = _pre_prompt_dialog_response(
                        uid=uid,
                        db=db,
                        text=text,
                        prompt_type=prompt_type,
                        chat_history=req.chat_history,
                        reasoning="pre_prompt:cheap_llm_chat",
                    )
                    return {
                        **out,
                        "router_trace": {**llm_out, "backend": "cheap_llm"},
                    }

                used_llm = True
                route_pre = {**llm_out, "backend": "cheap_llm", "router_log_id": log_id}
            except Exception as e:
                logger.warning("cheap_llm_pre_router failed: %s", e)

    if not used_llm:
        if not pre_prompt_rules_force_task(text):
            route_pre = route_pre_prompt_intent(text)
            branch = _resolve_pre_prompt_branch(text, route_pre)
            if branch == "meta":
                return _pre_prompt_dialog_response(
                    uid=uid,
                    db=db,
                    text=text,
                    prompt_type=prompt_type,
                    chat_history=req.chat_history,
                    reasoning=f"pre_prompt:semantic_meta intent={route_pre.get('intent')} "
                    f"conf={route_pre.get('confidence')} margin={route_pre.get('margin')}",
                )

    return _pre_prompt_task_branch(text, prompt_type, route_pre, force_skill_tab=False)


def _select_model_tier(complexity: str) -> str:
    """Select cost-appropriate model tier based on complexity."""
    if complexity == "low":
        return "tier1"
    if complexity == "high":
        return "tier3"
    return "tier2"
