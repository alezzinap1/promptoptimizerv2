"""Prompt generation."""
from __future__ import annotations

import logging
import json
import re
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from config.abuse import check_input_size
from config.settings import TRIAL_MAX_COMPLETION_PER_M
from backend.deps import (
    check_user_rate_limit,
    get_current_user,
    get_db,
    get_registry_for_user,
    get_session_id,
)
from services.trial_budget import effective_session_generation_budget, effective_trial_tokens_limit
from core.context_builder import CLARIFICATION_ANSWERS_PROVIDED, ContextBuilder
from core.domain_templates import get_domain_techniques
from core.parsing import diagnose_generation_response, parse_questions, parse_reply
from core.prompt_spec import build_generation_brief
from core.model_taxonomy import classify_model, ModelType, SUPPRESS_FOR_REASONING
from core.quality_metrics import analyze_prompt
from core.tokenizer import count_tokens
from core.image_presets import format_active_style_preset_system_block, get_image_preset
from core.image_style_tags import expand_image_tags_to_directives
from core.image_target_syntax import get_image_engine_syntax_block
from core.workspace_profile import normalize_workspace
from core.suggested_actions import build_suggested_actions
from db.manager import DBManager
from prompts import load_prompt
from services.api_key_resolver import resolve_openrouter_api_key
from core.context_gap import compute_context_gap, gap_missing_summary, get_questions_policy
from core.task_classifier import classify_task, heuristic_classification_confidence
from core.task_llm_classifier import classify_task_with_llm
from services.llm_client import LLMClient, DEFAULT_PROVIDER, PROVIDER_MODELS
from services.openrouter_models import get_model_pricing, completion_price_per_m
from services.prompt_workflow import (
    apply_evidence_decisions,
    build_preview_payload,
    resolve_techniques,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# Согласовано с фронтом: потолок для стабильного [PROMPT] (отчёт v5).
_GENERATION_TEMPERATURE_CAP = 0.85


def _split_image_questions_rules(raw: str) -> tuple[str, str]:
    m_a = "<<<IMAGE_QUESTIONS_APPEND>>>"
    m_s = "<<<IMAGE_QUESTIONS_STRICT>>>"
    if m_a not in raw or m_s not in raw:
        raise RuntimeError("backend/image_questions_rules.txt must contain APPEND and STRICT markers")
    _, after_a = raw.split(m_a, 1)
    append_part, strict_part = after_a.split(m_s, 1)
    return append_part.strip(), strict_part.strip()


def _skill_target_env_system_fragment(env: str | None) -> str:
    """Короткий блок для skill-режима: под какую среду оптимизировать скилл (отчёт v5)."""
    key = (env or "").strip().lower()
    if not key or key == "generic":
        return ""
    hints = {
        "claude": (
            "Target: Claude / Anthropic. Prefer clear ROLE/SCOPE/RULES sections, markdown-friendly layout, "
            "explicit refusal boundaries."
        ),
        "openai": (
            "Target: OpenAI Chat Completions or Assistants. Keep instructions imperative; mention tools/JSON mode "
            "only if the user task requires it."
        ),
        "langgraph": (
            "Target: LangGraph / stateful agents. Call out state keys, node responsibilities, and conditional edges."
        ),
        "crewai": (
            "Target: CrewAI-style crews. Separate agent roles, tools per role, and delegation rules."
        ),
    }
    body = hints.get(key)
    if not body:
        return ""
    return (
        "\n\n--- SKILL TARGET ENVIRONMENT ---\n"
        + body
        + "\n--- END SKILL TARGET ENVIRONMENT ---"
    )


IMAGE_PROMPT_MODE_BLOCK = load_prompt("backend/image_prompt_mode.txt")
_IMAGE_QUESTIONS_RULES_RAW = load_prompt("backend/image_questions_rules.txt")
IMAGE_QUESTIONS_APPEND, IMAGE_QUESTIONS_STRICT = _split_image_questions_rules(_IMAGE_QUESTIONS_RULES_RAW)
TEXT_QUESTIONS_STRICT = load_prompt("backend/text_questions_strict.txt")
SKILL_QUESTIONS_STRICT = load_prompt("backend/skill_questions_strict.txt")
SKILL_PROMPT_MODE_BLOCK = load_prompt("backend/skill_prompt_mode.txt")
QUESTIONS_CONTRACT_TEMPLATE = load_prompt("backend/questions_contract_system.txt")
QUESTIONS_CONTRACT_IMAGE_TEMPLATE = load_prompt("backend/questions_contract_image_system.txt")
QUESTIONS_CONTRACT_SKILL_TEMPLATE = load_prompt("backend/questions_contract_skill_system.txt")
ITERATION_GUARD_BLOCK = load_prompt("backend/iteration_guard.txt")


def _questions_contract_sys_for_prompt_type(prompt_type: str | None, max_q: int) -> str:
    pt = (prompt_type or "text").strip().lower()
    if pt == "image":
        return QUESTIONS_CONTRACT_IMAGE_TEMPLATE.format(max_q=max_q)
    if pt == "skill":
        return QUESTIONS_CONTRACT_SKILL_TEMPLATE.format(max_q=max_q)
    return QUESTIONS_CONTRACT_TEMPLATE.format(max_q=max_q)


def _task_primary_language_is_russian(task_input: str | None) -> bool:
    t = (task_input or "").strip()
    if not t:
        return False
    return any("\u0400" <= c <= "\u04ff" for c in t)


def _context_policy_block(
    *,
    context_gap: float,
    questions_policy: dict,
    prompt_type: str | None,
    task_input: str | None = None,
) -> str:
    pt = (prompt_type or "text").strip().lower()
    max_q = int(questions_policy.get("max_questions") or 0)
    mode = questions_policy.get("mode") or "skip"
    ru = _task_primary_language_is_russian(task_input)
    if pt == "image":
        if ru:
            body = (
                f"Задавай не больше {max_q} уточняющих вопросов, если визуального брифа мало; "
                f"режим={mode}. Только про картинку: кадр, стиль (если не задан пресетом), свет, палитра, соотношение сторон, детализация. "
                "Не спрашивай про цель сюжета, «как решить задачу сценария», аудиторию текстового ответа или формат вывода LLM. "
                "Все формулировки в ответе — на русском, как у задачи пользователя."
            )
        else:
            body = (
                f"Prefer at most {max_q} clarifying questions when the visual brief is thin; "
                f"mode={mode}. Ask only about image parameters (composition, style if no preset, lighting, aspect ratio, detail). "
                "Do not ask about story goals, plot solutions, morals, audience for text, or text output format. "
                "Match the user's task language for every question and option."
            )
    elif pt == "skill":
        if ru:
            body = (
                f"Не больше {max_q} вопросов, если границы скилла неясны; режим={mode}. "
                "Среда, инструменты/MCP, память, структура инструкций, ограничения. Ответ на языке задачи пользователя."
            )
        else:
            body = (
                f"Prefer at most {max_q} clarifying questions when skill scope is unclear; "
                f"mode={mode}. Focus on environment, tools/MCP, memory, instruction structure, and boundaries. "
                "Match the user's task language."
            )
    else:
        if ru:
            body = (
                f"Не больше {max_q} уточнений при разреженном контексте; режим={mode}. "
                "Короткая задача или неясные аудитория/формат — сначала вопросы. Язык ответа — как у пользователя."
            )
        else:
            body = (
                f"Prefer at most {max_q} clarifying questions when context is thin; "
                f"mode={mode}. Short tasks or missing audience/format usually need questions first."
            )
    return (
        f"\n\n--- CONTEXT POLICY (gap={context_gap:.2f}) ---\n"
        f"{body}\n"
        "--- END CONTEXT POLICY ---\n"
    )


def _build_technique_reasons(
    techniques: list[dict],
    classification: dict,
    prompt_type: str,
) -> list[dict[str, str]]:
    tts = ", ".join(classification.get("task_types") or ["general"])
    cx = classification.get("complexity") or "medium"
    out: list[dict[str, str]] = []
    for t in techniques:
        tid = t.get("id", "")
        wt = t.get("when_to_use") or {}
        hint = (wt.get("summary") or "").strip()
        if not hint:
            why = (t.get("why_it_works") or "").strip().replace("\n", " ")
            hint = (why[:140] + "…") if len(why) > 140 else why if why else str(t.get("name") or tid)
        if len(hint) > 180:
            hint = hint[:177] + "…"
        out.append(
            {
                "id": tid,
                "reason": f"Режим «{prompt_type}», тип задачи: {tts}, сложность: {cx}. {hint}",
            }
        )
    return out


def _should_enforce_questions_contract(
    policy: dict,
    gap: float,
    parsed: dict,
    questions: list | None,
) -> bool:
    if policy.get("mode") == "skip":
        return False
    if not parsed.get("has_prompt"):
        return False
    if parsed.get("has_questions") and questions and len(questions) > 0:
        return False
    if policy.get("mode") == "required":
        return True
    return gap >= 0.26


SCENE_ANALYSIS_SYSTEM = load_prompt("backend/scene_analysis_system.txt")


def _extract_json_object(raw: str) -> dict | None:
    text = (raw or "").strip()
    if not text:
        return None
    if text.startswith("```"):
        lines = text.split("\n")
        if len(lines) >= 2:
            inner = "\n".join(lines[1:])
            if inner.rstrip().endswith("```"):
                inner = inner[: inner.rfind("```")].rstrip()
            text = inner.strip()
    try:
        val = json.loads(text)
        return val if isinstance(val, dict) else None
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", text)
        if not m:
            return None
        try:
            val = json.loads(m.group(0))
            return val if isinstance(val, dict) else None
        except json.JSONDecodeError:
            return None


def _scene_analysis_user_text(task_input: str, clarification_answers_text: str, feedback: str) -> str:
    parts = [task_input.strip()]
    if clarification_answers_text.strip():
        parts.append("Уточнения:\n" + clarification_answers_text.strip())
    if feedback.strip():
        parts.append("Комментарий к улучшению:\n" + feedback.strip())
    return "\n\n".join(parts)


def _scene_analysis_provider(using_host_key: bool) -> str:
    """Дешёвая модель: на пробном ключе — в пределах лимита цены."""
    base = "gemini_flash"
    if not using_host_key:
        return "claude_haiku"
    return base


def _classification_from_saved_version(latest: dict, task_input: str) -> dict:
    """Восстановить классификацию с последней сохранённой версии сессии (итерация)."""
    tt = latest.get("task_types") or []
    if not isinstance(tt, list):
        tt = []
    if not tt:
        tt = ["general"]
    cx = str(latest.get("complexity") or "medium").lower()
    if cx not in ("low", "medium", "high"):
        cx = "medium"
    wc = len(task_input.split())
    has_code = bool(
        re.search(r"```|def |class |import |function |SELECT |INSERT ", task_input)
    )
    return {
        "task_types": tt,
        "complexity": cx,
        "word_count": wc,
        "has_code": has_code,
        "classification_source": "session_cache",
        "classifier_confidence": 1.0,
    }


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
    workspace_id: int | None = None
    prompt_spec_overrides: dict | None = None
    evidence_decisions: dict | None = None
    question_answers: list[dict] = []
    skill_body: str | None = None
    prompt_type: str = "text"
    image_prompt_tags: list[str] = Field(default_factory=list)
    image_preset_id: str | None = None
    # Целевой движок картинки (MJ/SD/…): подсказки синтаксиса в system prompt, не путать с gen_model.
    image_engine: str | None = None
    image_deep_mode: bool = False
    skill_preset_id: str | None = None
    # Среда развёртывания скилла: generic | claude | openai | langgraph | crewai
    skill_target_env: str | None = None
    recent_technique_ids: list[str] = Field(default_factory=list)
    expert_level: str | None = None


def _apply_expert_level_questions_policy(policy: dict, expert_level: str | None) -> dict:
    """Лёгкая подстройка лимита вопросов под профиль (фронт уже шлёт questions_mode)."""
    if not expert_level:
        return policy
    p = dict(policy)
    mq = int(p.get("max_questions") or 2)
    if expert_level == "junior":
        p["max_questions"] = min(5, max(mq, 3))
    elif expert_level == "senior":
        p["max_questions"] = max(1, min(mq, 2))
    elif expert_level == "creative":
        p["max_questions"] = min(5, mq + 1)
    return p


def _is_primary_generation_with_unanswered_questions(req: GenerateRequest) -> bool:
    """Первый проход: нет ответов на вопросы и не режим «улучшить промпт»."""
    if not req.questions_mode:
        return False
    if req.question_answers and len(req.question_answers) > 0:
        return False
    if req.previous_prompt and str(req.previous_prompt).strip():
        return False
    return True


def _resolve_image_preset_dict(preset_id: str | None, user_id: int, db: DBManager):
    if not preset_id or not str(preset_id).strip():
        return None
    s = str(preset_id).strip()
    if s.startswith("u_"):
        try:
            nid = int(s[2:])
        except ValueError:
            return None
        row = db.get_user_preset(nid, user_id)
        if not row or row.get("kind") != "image":
            return None
        pl = row.get("payload") or {}
        return {
            "id": s,
            "name": row["name"],
            "description": row.get("description") or "",
            "raw_text": pl.get("raw_text", ""),
        }
    return get_image_preset(s)


def _resolve_skill_preset_hint(preset_id: str | None, user_id: int, db: DBManager) -> str | None:
    if not preset_id or not str(preset_id).strip():
        return None
    s = str(preset_id).strip()
    if not s.startswith("u_"):
        return None
    try:
        nid = int(s[2:])
    except ValueError:
        return None
    row = db.get_user_preset(nid, user_id)
    if not row or row.get("kind") != "skill":
        return None
    pl = row.get("payload") or {}
    h = str(pl.get("hint", "")).strip()
    return h or None


def _check_session_budget(db: DBManager, user_id: int, auth_session_id: str | None) -> None:
    if not auth_session_id:
        return
    usage = db.get_user_usage(user_id)
    cap = effective_session_generation_budget(usage)
    events = db.get_recent_events(limit=1000, user_id=user_id)
    used = sum(
        1
        for event in events
        if event.get("session_id") == auth_session_id
        and event.get("event_name") in {"generate_requested", "compare_run"}
    )
    if used >= cap:
        raise HTTPException(
            429,
            f"Session generation budget ({cap}) exhausted. Start a new session.",
        )


def _build_answers_text(question_answers: list[dict]) -> str:
    lines: list[str] = []
    for item in question_answers:
        question = str(item.get("question") or "").strip()
        answers = [str(v).strip() for v in (item.get("answers") or []) if str(v).strip()]
        if question and answers:
            lines.append(f"{question}: {', '.join(answers)}")
    return "\n".join(lines)


def _get_openrouter_model_id(provider: str) -> str:
    """Resolve provider short name to OpenRouter model id."""
    if provider in PROVIDER_MODELS:
        return PROVIDER_MODELS[provider]
    if "/" in provider:
        return provider
    return provider


def _estimate_generation_input(
    req: GenerateRequest,
    user_id: int,
    db: DBManager,
    registry,
) -> dict:
    """
    Те же system+user, что у основной генерации, без вызовов LLM (классификатор, сцена).
    Токены анализа сцены при image_deep_mode добавляются отдельной оценкой.
    """
    workspace = None
    if req.workspace_id:
        workspace = db.get_workspace(req.workspace_id, user_id=user_id)
        if not workspace:
            raise HTTPException(404, f"Workspace {req.workspace_id} not found")

    hc = classify_task(req.task_input)
    classification = {
        **hc,
        "classification_source": "heuristic",
        "classifier_confidence": heuristic_classification_confidence(hc, req.task_input),
    }
    context_gap = compute_context_gap(
        req.task_input,
        workspace=workspace,
        prompt_type=req.prompt_type or "text",
    )
    questions_policy = get_questions_policy(context_gap, classification.get("complexity") or "medium")
    questions_policy = _apply_expert_level_questions_policy(questions_policy, req.expert_level)

    effective_overrides = apply_evidence_decisions(req.prompt_spec_overrides, req.evidence_decisions)
    preview = build_preview_payload(
        raw_input=req.task_input,
        target_model=req.target_model,
        workspace=workspace,
        previous_prompt=req.previous_prompt,
        overrides=effective_overrides,
        registry=registry,
        technique_mode=req.technique_mode,
        manual_techs=req.manual_techs,
        classification_override=classification,
        prompt_type=req.prompt_type or "text",
    )
    prompt_spec = preview["prompt_spec"]

    techniques = resolve_techniques(
        registry=registry,
        classification=classification,
        target_model=req.target_model,
        technique_mode=req.technique_mode,
        manual_techs=req.manual_techs,
        max_techniques=4,
        user_input=req.task_input,
        prompt_type=req.prompt_type or "text",
        recent_technique_ids=req.recent_technique_ids or None,
    )
    technique_ids = [t["id"] for t in techniques]

    if req.domain and req.domain != "auto" and req.technique_mode != "manual":
        domain_tech_ids = get_domain_techniques(req.domain)
        if domain_tech_ids:
            techniques = [t for t in (registry.get(tid) for tid in domain_tech_ids) if t]
            technique_ids = [t["id"] for t in techniques]

    builder = ContextBuilder(registry)

    combined_input = build_generation_brief(prompt_spec)
    clarification_answers_text = _build_answers_text(req.question_answers) if req.question_answers else ""
    if clarification_answers_text:
        combined_input += f"\n\nОтветы на уточняющие вопросы:\n{clarification_answers_text}"
    if req.feedback.strip():
        combined_input += f"\n\nКомментарий к улучшению: {req.feedback}"
    if req.prompt_type == "image" and req.image_prompt_tags:
        tag_block = expand_image_tags_to_directives(req.image_prompt_tags)
        if tag_block:
            combined_input += "\n\n" + tag_block

    image_preset_dict = None
    if req.prompt_type == "image":
        image_preset_dict = _resolve_image_preset_dict(req.image_preset_id, user_id, db)

    scene_extra_tokens = 0
    if req.prompt_type == "image" and req.image_deep_mode:
        scene_user = _scene_analysis_user_text(req.task_input, clarification_answers_text, req.feedback)
        scene_extra_tokens = (len(SCENE_ANALYSIS_SYSTEM) + len(scene_user) + 380) // 4

    system_prompt = builder.build_system_prompt(
        technique_ids=technique_ids,
        target_model=req.target_model,
        domain=req.domain or "auto",
        questions_mode=req.questions_mode,
        prompt_type=req.prompt_type or "text",
    )
    if _is_primary_generation_with_unanswered_questions(req) and questions_policy.get("mode") != "skip":
        system_prompt += _context_policy_block(
            context_gap=context_gap,
            questions_policy=questions_policy,
            prompt_type=req.prompt_type,
            task_input=req.task_input,
        )
    if req.prompt_type == "image":
        system_prompt += IMAGE_PROMPT_MODE_BLOCK
        if req.questions_mode:
            system_prompt += IMAGE_QUESTIONS_APPEND
        system_prompt += get_image_engine_syntax_block(req.image_engine)
        if image_preset_dict:
            system_prompt += format_active_style_preset_system_block(image_preset_dict)
        if _is_primary_generation_with_unanswered_questions(req):
            system_prompt += IMAGE_QUESTIONS_STRICT
    elif req.prompt_type == "skill":
        system_prompt += SKILL_PROMPT_MODE_BLOCK
        sp_hint = _resolve_skill_preset_hint(req.skill_preset_id, user_id, db)
        if sp_hint:
            system_prompt += (
                "\n\n--- USER SKILL PRESET ---\n"
                "Дополнительные правила для этой генерации скилла (язык и структура — по запросу пользователя):\n"
                + sp_hint
                + "\n--- END USER SKILL PRESET ---"
            )
        if _is_primary_generation_with_unanswered_questions(req):
            system_prompt += SKILL_QUESTIONS_STRICT
        system_prompt += _skill_target_env_system_fragment(req.skill_target_env)
    if req.prompt_type == "text" and _is_primary_generation_with_unanswered_questions(req):
        system_prompt += TEXT_QUESTIONS_STRICT
    if req.skill_body and req.skill_body.strip():
        system_prompt += (
            "\n\n--- ACTIVE SKILL ---\n"
            "The user has an active skill that provides additional context and instructions. "
            "Incorporate the skill's guidance into the generated prompt:\n\n"
            + req.skill_body.strip()
            + "\n--- END SKILL ---"
        )
    if clarification_answers_text:
        system_prompt = system_prompt + "\n\n" + CLARIFICATION_ANSWERS_PROVIDED
    if req.previous_prompt and str(req.previous_prompt).strip():
        system_prompt = system_prompt + "\n\n" + ITERATION_GUARD_BLOCK
    user_content = builder.build_user_content(
        combined_input,
        previous_agent_prompt=req.previous_prompt,
        task_classification=classification,
    )

    gen_model_id = _get_openrouter_model_id(req.gen_model)
    main_tokens = count_tokens(system_prompt + "\n\n" + user_content, gen_model_id)["tokens"]
    input_token_estimate = main_tokens + scene_extra_tokens

    task_preview = analyze_prompt(
        req.task_input.strip(),
        req.target_model,
        prompt_type=req.prompt_type or "text",
        task_input=req.task_input,
    )

    return {
        "input_token_estimate": input_token_estimate,
        "main_request_tokens": main_tokens,
        "scene_analysis_tokens_estimate": scene_extra_tokens,
        "task_preview": {
            "completeness_score": task_preview.get("completeness_score"),
            "completeness_label": task_preview.get("completeness_label"),
            "token_method": task_preview.get("token_method"),
        },
        "context_gap": context_gap,
    }


@router.post("/generate/estimate")
def estimate_generate_input(
    req: GenerateRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
    registry = Depends(get_registry_for_user),
    auth_session_id: str | None = Depends(get_session_id),
):
    """Оценка входных токенов и полноты формулировки задачи без вызова генерации."""
    ok, err = check_input_size(req.task_input)
    if not ok:
        raise HTTPException(400, err)
    ok, err = check_user_rate_limit(db, int(user["id"]), auth_session_id)
    if not ok:
        raise HTTPException(429, err)
    user_id = int(user["id"])
    try:
        return _estimate_generation_input(req, user_id, db, registry)
    except HTTPException:
        raise


@router.post("/generate")
def generate_prompt(
    req: GenerateRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
    registry = Depends(get_registry_for_user),
    auth_session_id: str | None = Depends(get_session_id),
):
    """Generate prompt. Returns full result (LLM call is blocking)."""
    ok, err = check_input_size(req.task_input)
    if not ok:
        raise HTTPException(400, err)
    ok, err = check_user_rate_limit(db, int(user["id"]), auth_session_id)
    if not ok:
        raise HTTPException(429, err)
    _check_session_budget(db, int(user["id"]), auth_session_id)

    user_id = int(user["id"])
    user_key = db.get_user_openrouter_api_key(user_id)
    api_key = resolve_openrouter_api_key(user_key)
    if not api_key:
        raise HTTPException(
            500,
            "OpenRouter API key not set. Введите свой ключ в Настройках или настройте OPENROUTER_API_KEY на сервере.",
        )

    using_host_key = not bool(user_key)
    if using_host_key:
        usage = db.get_user_usage(user_id)
        lim = effective_trial_tokens_limit(usage)
        if usage["tokens_used"] >= lim:
            raise HTTPException(
                402,
                f"Пробный лимит ({lim:,} токенов) исчерпан. Введите свой API ключ OpenRouter в Настройках для продолжения.",
            )
        model_id = _get_openrouter_model_id(req.gen_model)
        comp_per_m = completion_price_per_m(model_id)
        if comp_per_m > TRIAL_MAX_COMPLETION_PER_M:
            raise HTTPException(
                403,
                f"Модель {req.gen_model} недоступна в пробном режиме (выход >${TRIAL_MAX_COMPLETION_PER_M}/1M). "
                "Введите свой API ключ в Настройках для доступа ко всем моделям.",
            )

    llm = LLMClient(api_key)
    effective_temperature = min(float(req.temperature), _GENERATION_TEMPERATURE_CAP)
    session_id = req.session_id or str(uuid.uuid4())
    workspace = None
    if req.workspace_id:
        workspace = db.get_workspace(req.workspace_id, user_id=int(user["id"]))
        if not workspace:
            raise HTTPException(404, f"Workspace {req.workspace_id} not found")

    prefs_row = db.get_user_preferences(user_id)
    cls_mode = str(prefs_row.get("task_classification_mode") or "heuristic").lower()
    cls_model_pref = str(prefs_row.get("task_classifier_model") or "").strip()

    classification = None
    want_pt = req.prompt_type or "text"
    if (
        cls_mode == "llm"
        and req.previous_prompt
        and str(req.previous_prompt).strip()
    ):
        latest_v = db.get_latest_version(session_id, user_id=user_id)
        if latest_v:
            saved_pt = (latest_v.get("metrics") or {}).get("studio_prompt_type")
            if saved_pt == want_pt:
                classification = _classification_from_saved_version(latest_v, req.task_input)

    if classification is None:
        if cls_mode == "llm":
            cls_provider = cls_model_pref or PROVIDER_MODELS.get("gemini_flash", "google/gemini-flash-1.5")
            if using_host_key:
                cmid = _get_openrouter_model_id(cls_provider)
                if completion_price_per_m(cmid) > TRIAL_MAX_COMPLETION_PER_M:
                    cls_provider = PROVIDER_MODELS.get("gemini_flash", "google/gemini-flash-1.5")
            classification = classify_task_with_llm(llm, cls_provider, req.task_input)
            if using_host_key:
                c_raw = len(req.task_input) + 400
                model_id = _get_openrouter_model_id(cls_provider)
                pr, cp = get_model_pricing(model_id)
                db.add_user_usage(user_id, c_raw // 4, (c_raw // 4) * (pr + cp))
        else:
            hc = classify_task(req.task_input)
            classification = {
                **hc,
                "classification_source": "heuristic",
                "classifier_confidence": heuristic_classification_confidence(hc, req.task_input),
            }

    db.log_event(
        event_name="generate_requested",
        session_id=auth_session_id or "",
        payload={
            "iteration_mode": bool(req.previous_prompt),
            "questions_mode": req.questions_mode,
            "technique_mode": req.technique_mode,
            "workspace_id": req.workspace_id or 0,
            "task_classification_mode": cls_mode,
        },
        user_id=int(user["id"]),
    )

    context_gap = compute_context_gap(
        req.task_input,
        workspace=workspace,
        prompt_type=req.prompt_type or "text",
    )
    questions_policy = get_questions_policy(context_gap, classification.get("complexity") or "medium")
    questions_policy = _apply_expert_level_questions_policy(questions_policy, req.expert_level)

    effective_overrides = apply_evidence_decisions(req.prompt_spec_overrides, req.evidence_decisions)
    preview = build_preview_payload(
        raw_input=req.task_input,
        target_model=req.target_model,
        workspace=workspace,
        previous_prompt=req.previous_prompt,
        overrides=effective_overrides,
        registry=registry,
        technique_mode=req.technique_mode,
        manual_techs=req.manual_techs,
        classification_override=classification,
        prompt_type=req.prompt_type or "text",
    )
    prompt_spec = preview["prompt_spec"]
    evidence = preview["evidence"]
    debug_issues = preview["debug_issues"]
    intent_graph = preview["intent_graph"]

    db.save_prompt_spec(
        session_id=session_id,
        raw_input=req.task_input,
        workspace_id=workspace.get("id") if workspace else None,
        spec=prompt_spec,
        evidence=evidence,
        issues=debug_issues,
        user_id=int(user["id"]),
    )

    techniques = resolve_techniques(
        registry=registry,
        classification=classification,
        target_model=req.target_model,
        technique_mode=req.technique_mode,
        manual_techs=req.manual_techs,
        max_techniques=4,
        user_input=req.task_input,
        prompt_type=req.prompt_type or "text",
        recent_technique_ids=req.recent_technique_ids or None,
    )
    technique_ids = [t["id"] for t in techniques]
    technique_reasons = _build_technique_reasons(techniques, classification, req.prompt_type or "text")

    if req.domain and req.domain != "auto" and req.technique_mode != "manual":
        domain_tech_ids = get_domain_techniques(req.domain)
        if domain_tech_ids:
            techniques = [t for t in (registry.get(tid) for tid in domain_tech_ids) if t]
            technique_ids = [t["id"] for t in techniques]
            technique_reasons = _build_technique_reasons(techniques, classification, req.prompt_type or "text")

    builder = ContextBuilder(registry)

    combined_input = build_generation_brief(prompt_spec)
    clarification_answers_text = _build_answers_text(req.question_answers) if req.question_answers else ""
    if clarification_answers_text:
        combined_input += f"\n\nОтветы на уточняющие вопросы:\n{clarification_answers_text}"
    if req.feedback.strip():
        combined_input += f"\n\nКомментарий к улучшению: {req.feedback}"
    if req.prompt_type == "image" and req.image_prompt_tags:
        tag_block = expand_image_tags_to_directives(req.image_prompt_tags)
        if tag_block:
            combined_input += "\n\n" + tag_block

    image_preset_dict = None
    if req.prompt_type == "image":
        image_preset_dict = _resolve_image_preset_dict(req.image_preset_id, user_id, db)

    scene_analysis_applied = False
    if req.prompt_type == "image" and req.image_deep_mode:
        scene_user = _scene_analysis_user_text(req.task_input, clarification_answers_text, req.feedback)
        spa = _scene_analysis_provider(using_host_key)
        if using_host_key:
            cmid = _get_openrouter_model_id(spa)
            if completion_price_per_m(cmid) > TRIAL_MAX_COMPLETION_PER_M:
                spa = "gemini_flash"
        # Несколько провайдеров: старая модель на OpenRouter может отвалиться → не роняем весь /generate
        scene_providers = [spa, "gemini_flash", "gpt4o_mini", "deepseek"]
        ordered = list(dict.fromkeys(scene_providers))
        raw_scene = ""
        scene_obj = None
        used_sp = spa
        for sp_try in ordered:
            try:
                used_sp = sp_try
                raw_scene = llm.generate(SCENE_ANALYSIS_SYSTEM, scene_user, sp_try, temperature=0.35)
                scene_obj = _extract_json_object(raw_scene)
                break
            except Exception:
                logger.warning("scene analysis failed with provider %s, trying next", sp_try, exc_info=True)
                continue
        if scene_obj:
            scene_analysis_applied = True
            combined_input += (
                "\n\n--- STRUCTURED SCENE BRIEF (analyser output; treat as facts, expand into a rich image prompt) ---\n"
                + json.dumps(scene_obj, ensure_ascii=False, indent=2)
                + "\n--- END SCENE BRIEF ---"
            )
        if using_host_key and raw_scene:
            c_raw = len(SCENE_ANALYSIS_SYSTEM) + len(scene_user) + len(raw_scene) + 200
            model_id = _get_openrouter_model_id(used_sp)
            pr, cp = get_model_pricing(model_id)
            db.add_user_usage(user_id, c_raw // 4, (c_raw // 4) * (pr + cp))

    system_prompt = builder.build_system_prompt(
        technique_ids=technique_ids,
        target_model=req.target_model,
        domain=req.domain or "auto",
        questions_mode=req.questions_mode,
        prompt_type=req.prompt_type or "text",
    )
    if _is_primary_generation_with_unanswered_questions(req) and questions_policy.get("mode") != "skip":
        system_prompt += _context_policy_block(
            context_gap=context_gap,
            questions_policy=questions_policy,
            prompt_type=req.prompt_type,
            task_input=req.task_input,
        )
    if req.prompt_type == "image":
        system_prompt += IMAGE_PROMPT_MODE_BLOCK
        if req.questions_mode:
            system_prompt += IMAGE_QUESTIONS_APPEND
        system_prompt += get_image_engine_syntax_block(req.image_engine)
        if image_preset_dict:
            system_prompt += format_active_style_preset_system_block(image_preset_dict)
        if _is_primary_generation_with_unanswered_questions(req):
            system_prompt += IMAGE_QUESTIONS_STRICT
    elif req.prompt_type == "skill":
        system_prompt += SKILL_PROMPT_MODE_BLOCK
        sp_hint = _resolve_skill_preset_hint(req.skill_preset_id, user_id, db)
        if sp_hint:
            system_prompt += (
                "\n\n--- USER SKILL PRESET ---\n"
                "Дополнительные правила для этой генерации скилла (язык и структура — по запросу пользователя):\n"
                + sp_hint
                + "\n--- END USER SKILL PRESET ---"
            )
        if _is_primary_generation_with_unanswered_questions(req):
            system_prompt += SKILL_QUESTIONS_STRICT
        system_prompt += _skill_target_env_system_fragment(req.skill_target_env)
    if req.prompt_type == "text" and _is_primary_generation_with_unanswered_questions(req):
        system_prompt += TEXT_QUESTIONS_STRICT
    if req.skill_body and req.skill_body.strip():
        system_prompt += (
            "\n\n--- ACTIVE SKILL ---\n"
            "The user has an active skill that provides additional context and instructions. "
            "Incorporate the skill's guidance into the generated prompt:\n\n"
            + req.skill_body.strip()
            + "\n--- END SKILL ---"
        )
    if clarification_answers_text:
        system_prompt = system_prompt + "\n\n" + CLARIFICATION_ANSWERS_PROVIDED
    if req.previous_prompt and str(req.previous_prompt).strip():
        system_prompt = system_prompt + "\n\n" + ITERATION_GUARD_BLOCK
    user_content = builder.build_user_content(
        combined_input,
        previous_agent_prompt=req.previous_prompt,
        task_classification=classification,
    )

    gen_model_id = _get_openrouter_model_id(req.gen_model)
    input_token_estimate = count_tokens(system_prompt + "\n\n" + user_content, gen_model_id)["tokens"]

    started_at = time.perf_counter()
    full_text = ""
    for chunk in llm.stream(
        system_prompt,
        user_content,
        req.gen_model,
        effective_temperature,
        top_p=req.top_p,
        top_k=req.top_k,
    ):
        full_text += chunk

    full_text = (full_text or "").strip()
    parsed = parse_reply(full_text)
    questions = parse_questions(parsed.get("questions_raw", "")) or []
    questions_enforced = False

    if (
        _is_primary_generation_with_unanswered_questions(req)
        and _should_enforce_questions_contract(questions_policy, context_gap, parsed, questions)
    ):
        q_provider = _scene_analysis_provider(using_host_key)
        if using_host_key:
            cmid_q = _get_openrouter_model_id(q_provider)
            if completion_price_per_m(cmid_q) > TRIAL_MAX_COMPLETION_PER_M:
                q_provider = "gemini_flash"
        max_q = int(questions_policy.get("max_questions") or 2)
        max_q = max(1, min(5, max_q))
        missing = gap_missing_summary(req.task_input, req.prompt_type or "text")
        contract_sys = _questions_contract_sys_for_prompt_type(req.prompt_type, max_q)
        pt = (req.prompt_type or "text").strip().lower()
        ru = _task_primary_language_is_russian(req.task_input)
        if ru:
            if pt == "image":
                gap_label = "Визуальные пробелы (только промпт к изображению)"
            elif pt == "skill":
                gap_label = "Пробелы в описании скилла"
            else:
                gap_label = "Пробелы контекста"
            lang_tail = (
                f"Сформируй до {max_q} точечных вопросов на русском (и варианты «- » тоже на русском). "
                "Не выводи [PROMPT]."
            )
            task_hdr = "Задача пользователя"
        else:
            if pt == "image":
                gap_label = "Identified visual gaps to clarify (image prompt only)"
            elif pt == "skill":
                gap_label = "Identified gaps to clarify (skill definition only)"
            else:
                gap_label = "Identified gaps to clarify"
            lang_tail = (
                f"Ask up to {max_q} targeted questions in the SAME language as the user task. "
                "Do not output [PROMPT]."
            )
            task_hdr = "User task"
        preset_extra = ""
        if pt == "image" and image_preset_dict:
            pname = str(image_preset_dict.get("name") or image_preset_dict.get("id") or "")
            raw_prev = (str(image_preset_dict.get("raw_text") or "")).strip()
            if len(raw_prev) > 900:
                raw_prev = raw_prev[:897] + "…"
            if ru:
                preset_extra = (
                    f"\n\nУже выбран пресет стиля: {pname}. Не проси пользователя выбрать «совсем другой» общий стиль/технику; "
                    "допустимы только уточнения кадра, света или деталей, если их нет в задаче.\n"
                    f"Описание пресета:\n{raw_prev}\n"
                )
            else:
                preset_extra = (
                    f"\n\nStyle preset already selected: {pname}. Do not ask for a wholly different art style/medium; "
                    "only framing/light/detail if missing.\n"
                    f"Preset detail:\n{raw_prev}\n"
                )
        contract_user = (
            f"{task_hdr}:\n{req.task_input.strip()}\n\n"
            f"{gap_label}:\n{missing}\n"
            f"{preset_extra}\n"
            f"{lang_tail}"
        )
        try:
            q_pass = llm.generate(contract_sys, contract_user, q_provider, temperature=0.35)
            q_pass = (q_pass or "").strip()
            parsed_q = parse_reply(q_pass)
            q_list = parse_questions(parsed_q.get("questions_raw", "")) or []
            if parsed_q.get("has_questions") and q_list:
                full_text = q_pass
                parsed = {
                    **parsed_q,
                    "has_prompt": False,
                    "prompt_block": "",
                }
                questions = q_list
                questions_enforced = True
                if using_host_key:
                    c_raw = len(contract_sys) + len(contract_user) + len(q_pass) + 120
                    model_id = _get_openrouter_model_id(q_provider)
                    pr, cp = get_model_pricing(model_id)
                    db.add_user_usage(user_id, c_raw // 4, (c_raw // 4) * (pr + cp))
        except Exception:
            pass

    gen_flags = diagnose_generation_response(parsed, questions)
    generation_issue: str | None = None
    if gen_flags["format_failure"]:
        generation_issue = "format_failure"
    elif gen_flags["questions_unparsed"]:
        generation_issue = "questions_unparsed"
    elif gen_flags["weak_question_options"]:
        generation_issue = "weak_question_options"
    if (
        req.previous_prompt
        and str(req.previous_prompt).strip()
        and parsed.get("has_questions")
        and not parsed.get("has_prompt")
        and not generation_issue
    ):
        generation_issue = "iteration_with_questions"
    metrics = (
        analyze_prompt(
            parsed.get("prompt_block", ""),
            req.target_model,
            prompt_type=req.prompt_type or "text",
            task_input=req.task_input,
        )
        if parsed.get("has_prompt")
        else {}
    )
    if parsed.get("has_prompt") and metrics:
        pt = (parsed.get("prompt_title") or "").strip()
        if pt:
            metrics["prompt_title"] = pt
    latency_ms = round((time.perf_counter() - started_at) * 1000, 1)
    outcome = "prompt" if parsed.get("has_prompt") else "questions" if parsed.get("has_questions") else "raw_text"

    if using_host_key:
        prompt_tokens = int(metrics.get("token_estimate", 0) or 0)
        completion_tokens = max(0, len(full_text) // 4)
        total_tokens = prompt_tokens + completion_tokens
        model_id = _get_openrouter_model_id(req.gen_model)
        prompt_price, comp_price = get_model_pricing(model_id)
        cost = (prompt_tokens * prompt_price) + (completion_tokens * comp_price)
        db.add_user_usage(user_id, total_tokens, cost)

    db.log_event(
        "generation_result",
        session_id=auth_session_id or "",
        payload={
            "outcome": outcome,
            "gen_model": req.gen_model,
            "target_model": req.target_model,
            "latency_ms": latency_ms,
            "technique_ids": technique_ids,
            "completeness_score": metrics.get("completeness_score", 0.0),
            "questions_contract_used": bool(questions_enforced),
            "scene_analysis_applied": scene_analysis_applied,
        },
        user_id=int(user["id"]),
    )

    if parsed.get("has_prompt"):
        metrics_to_save = {**metrics, "studio_prompt_type": req.prompt_type or "text"}
        db.save_prompt_version(
            session_id=session_id,
            task_input=req.task_input,
            task_types=classification["task_types"],
            complexity=classification["complexity"],
            target_model=req.target_model,
            gen_model=req.gen_model,
            techniques_used=technique_ids,
            reasoning=parsed.get("reasoning", ""),
            final_prompt=parsed["prompt_block"],
            metrics=metrics_to_save,
            user_id=int(user["id"]),
        )
        db.log_event(
            "generate_prompt_success",
            session_id=auth_session_id or "",
            payload={
                "target_model": req.target_model,
                "gen_model": req.gen_model,
                "completeness_score": metrics.get("completeness_score", 0.0),
                "workspace_id": workspace.get("id") if workspace else None,
                "debug_issue_count": len(debug_issues),
            },
            user_id=int(user["id"]),
        )
    elif parsed.get("has_questions"):
        db.log_event(
            "generate_questions",
            session_id=auth_session_id or "",
            payload={
                "target_model": req.target_model,
                "gen_model": req.gen_model,
                "question_count": len(questions),
            },
            user_id=int(user["id"]),
        )
    else:
        db.log_event(
            "generate_raw_text",
            session_id=auth_session_id or "",
            payload={"target_model": req.target_model, "gen_model": req.gen_model},
            user_id=int(user["id"]),
        )

    target_model_type = classify_model(req.target_model)

    # После ответов на уточнения модель иногда оставляет хвост [QUESTIONS] вместе с [PROMPT] —
    # иначе клиент остаётся в режиме вопросов без показа результата.
    if parsed.get("has_prompt"):
        questions = []
        parsed = {**parsed, "has_questions": False, "questions_raw": ""}

    suggested_actions = build_suggested_actions(
        has_prompt=bool(parsed.get("has_prompt")),
        prompt_type=req.prompt_type or "text",
        current_prompt=(parsed.get("prompt_block") or "").strip() or None
        if parsed.get("has_prompt")
        else None,
        metrics=metrics,
    )

    return {
        **parsed,
        "llm_raw": full_text,
        "generation_issue": generation_issue,
        "generation_flags": gen_flags,
        "questions": questions,
        "context_gap": context_gap,
        "questions_policy": questions_policy,
        "questions_enforced": questions_enforced,
        "techniques": [{"id": t["id"], "name": t.get("name", t["id"])} for t in techniques],
        "technique_ids": technique_ids,
        "technique_reasons": technique_reasons,
        "task_types": classification["task_types"],
        "complexity": classification["complexity"],
        "task_input": req.task_input,
        "prompt_type": req.prompt_type or "text",
        "gen_model": req.gen_model,
        "target_model": req.target_model,
        "target_model_type": target_model_type.value,
        "metrics": metrics,
        "input_token_estimate": input_token_estimate,
        "prompt_spec": prompt_spec,
        "evidence": evidence,
        "debug_issues": debug_issues,
        "intent_graph": intent_graph,
        "workspace": normalize_workspace(workspace),
        "session_id": session_id,
        "scene_analysis_applied": scene_analysis_applied,
        "questions_contract_used": bool(questions_enforced),
        "suggested_actions": suggested_actions,
        "test_cases": parsed.get("test_cases") or [],
    }


@router.post("/generate/stream")
def generate_prompt_stream(
    req: GenerateRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
    registry = Depends(get_registry_for_user),
    auth_session_id: str | None = Depends(get_session_id),
):
    """
    SSE-обёртка над полной генерацией: одно событие `done` с тем же телом, что у POST /generate.
    Клиент может парсить поток; поэтапные `chunk` добавятся при выносе стрима LLM в общий генератор.
    """
    result = generate_prompt(req, user, db, registry, auth_session_id)

    def events():
        yield f"data: {json.dumps({'type': 'done', 'result': result}, ensure_ascii=False)}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream")
