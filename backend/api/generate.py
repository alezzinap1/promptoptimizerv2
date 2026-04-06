"""Prompt generation."""
from __future__ import annotations

import json
import re
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from config.abuse import check_input_size, check_rate_limit
from config.settings import BUDGET_GENERATIONS_PER_SESSION, TRIAL_TOKENS_LIMIT, TRIAL_MAX_COMPLETION_PER_M
from backend.deps import get_current_user, get_db, get_registry_for_user, get_session_id
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
from db.manager import DBManager
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

router = APIRouter()

IMAGE_PROMPT_MODE_BLOCK = (
    "\n\n--- IMAGE PROMPT MODE ---\n"
    "The user wants a prompt for AI image generation (Midjourney, DALL-E, Stable Diffusion, Flux, etc.).\n"
    "\n"
    "LANGUAGE (critical): The entire text inside [PROMPT] must be in the SAME language as the user's task "
    "in the user message below (Russian task → Russian prompt; English → English). Do not default to English "
    "only because many image prompts online are in English, unless the user explicitly asked for English tags.\n"
    "\n"
    "Structure the image prompt with clear sections, for example:\n"
    "1. **Subject / Субъект** — who or what, action\n"
    "2. **Style / Стиль** — medium, references (claymation, oil, 3D…)\n"
    "3. **Composition / Композиция** — framing, camera, depth of field\n"
    "4. **Lighting & palette / Свет и палитра**\n"
    "5. **Negative / Негатив** — what to avoid\n"
    "6. **Technical / Техника** — aspect ratio, quality, if relevant\n"
    "\n"
    "Use concrete visual language. Include technical parameters when useful.\n"
    "--- END IMAGE PROMPT MODE ---"
)

IMAGE_QUESTIONS_APPEND = (
    "\n\n[Image questions] When you output [QUESTIONS], ask about: aspect ratio (1:1, 16:9, 9:16…), "
    "visual style (realism / cartoon / minimal / illustration / cinematic), lighting and mood, color palette, "
    "detail level, single subject vs full scene. Each question must include short badge-like options (2–5 words) "
    "and at least 2 meaningful alternatives per question. Use the same language as the user's task.\n"
)

# Режим вопросов: пока пользователь не ответил на уточнения и это не итерация промпта — жёстче требовать [QUESTIONS].
IMAGE_QUESTIONS_STRICT = (
    "\n\n--- IMAGE — ОБЯЗАТЕЛЬНЫЕ УТОЧНЕНИЯ (режим вопросов) ---\n"
    "В этом запросе нет ответов на уточняющие вопросы и нет «улучшения существующего промпта» (первичная генерация).\n"
    "Верни [QUESTIONS]...[/QUESTIONS], а не [PROMPT], если в формулировке пользователя не раскрыты явно: "
    "соотношение сторон; визуальный стиль; тёплая/холодная/нейтральная палитра; ключевой свет и настроение; "
    "уровень детализации; один объект или целая сцена.\n"
    "Если пользователь уже дал исчерпывающее ТЗ по всем пунктам — можно [PROMPT]. "
    "Язык вопросов — как у задачи пользователя; варианты строками «- ».\n"
    "--- END IMAGE STRICT ---"
)

TEXT_QUESTIONS_STRICT = (
    "\n\n--- TEXT — РЕЖИМ ВОПРОСОВ (строже) ---\n"
    "Ответов на уточнения в сообщении нет; это первичная генерация (не итерация по готовому промпту).\n"
    "Если цель, аудитория, формат ответа целевой модели или жёсткие ограничения не ясны — верни [QUESTIONS], не [PROMPT]. "
    "Длинный текст без явной цели не считается достаточным основанием для [PROMPT].\n"
    "--- END TEXT STRICT ---"
)

SKILL_QUESTIONS_STRICT = (
    "\n\n--- SKILL — РЕЖИМ ВОПРОСОВ (строже) ---\n"
    "Ответов на уточнения нет; первичная генерация скилла.\n"
    "Если не ясны: среда (Cursor/Claude/общий), язык, глубина, формат вывода (YAML/Markdown), границы скилла — "
    "верни [QUESTIONS], не [PROMPT].\n"
    "--- END SKILL STRICT ---"
)

QUESTIONS_CONTRACT_SYSTEM = """You are a requirements analyst for prompt engineering.
Your ONLY output must be the block [QUESTIONS]...[/QUESTIONS]. Nothing else.

Rules:
- Do NOT write [PROMPT], [REASONING], or code fences for a full prompt.
- Ask at most {max_q} questions; each answerable in 1–2 short lines.
- Use the SAME language as the user's task (Russian if the task is Russian).
- Number questions 1. 2. … and under each question list 2–5 short options as lines starting with "- ".

Output shape:
[QUESTIONS]
1. ...
- ...
- ...
2. ...
...
[/QUESTIONS]
"""


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


SCENE_ANALYSIS_SYSTEM = """You are a visual scene analyst for text-to-image workflows.
Given the user's description (and any clarifications), output ONLY a single JSON object. No markdown fences, no commentary before or after.
Keys (use the same language as the user for string values):
- "subject": main subject and action
- "setting": environment / location
- "mood": emotional tone
- "lighting": light quality and direction
- "camera": framing, lens feel, shot scale if inferable
- "style_notes": artistic direction
- "negative": what to avoid visually (string, may be empty)
Use empty string "" for unknown values rather than omitting keys."""


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
    recent_technique_ids: list[str] = Field(default_factory=list)


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
    events = db.get_recent_events(limit=1000, user_id=user_id)
    used = sum(
        1
        for event in events
        if event.get("session_id") == auth_session_id
        and event.get("event_name") in {"generate_requested", "compare_run"}
    )
    if used >= BUDGET_GENERATIONS_PER_SESSION:
        raise HTTPException(
            429,
            f"Session generation budget ({BUDGET_GENERATIONS_PER_SESSION}) exhausted. Start a new session.",
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
    ok, err = check_rate_limit(auth_session_id or str(user["id"]))
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
        if usage["tokens_used"] >= TRIAL_TOKENS_LIMIT:
            raise HTTPException(
                402,
                f"Пробный лимит ({TRIAL_TOKENS_LIMIT:,} токенов) исчерпан. Введите свой API ключ OpenRouter в Настройках для продолжения.",
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
    session_id = req.session_id or str(uuid.uuid4())
    workspace = None
    if req.workspace_id:
        workspace = db.get_workspace(req.workspace_id, user_id=int(user["id"]))
        if not workspace:
            raise HTTPException(404, f"Workspace {req.workspace_id} not found")

    prefs_row = db.get_user_preferences(user_id)
    cls_mode = str(prefs_row.get("task_classification_mode") or "heuristic").lower()
    cls_model_pref = str(prefs_row.get("task_classifier_model") or "").strip()
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

    if req.prompt_type == "image" and req.image_deep_mode:
        spa = _scene_analysis_provider(using_host_key)
        if using_host_key:
            cmid = _get_openrouter_model_id(spa)
            if completion_price_per_m(cmid) > TRIAL_MAX_COMPLETION_PER_M:
                spa = "gemini_flash"
        scene_user = _scene_analysis_user_text(req.task_input, clarification_answers_text, req.feedback)
        raw_scene = llm.generate(SCENE_ANALYSIS_SYSTEM, scene_user, spa, temperature=0.35)
        scene_obj = _extract_json_object(raw_scene)
        if scene_obj:
            combined_input += (
                "\n\n--- STRUCTURED SCENE BRIEF (analyser output; treat as facts, expand into a rich image prompt) ---\n"
                + json.dumps(scene_obj, ensure_ascii=False, indent=2)
                + "\n--- END SCENE BRIEF ---"
            )
        if using_host_key:
            c_raw = len(SCENE_ANALYSIS_SYSTEM) + len(scene_user) + len(raw_scene) + 200
            model_id = _get_openrouter_model_id(spa)
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
        system_prompt += (
            f"\n\n--- CONTEXT POLICY (gap={context_gap:.2f}) ---\n"
            f"Prefer at most {questions_policy['max_questions']} clarifying questions when context is thin; "
            f"mode={questions_policy['mode']}. Short tasks or missing audience/format usually need questions first.\n"
            "--- END CONTEXT POLICY ---\n"
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
        system_prompt += (
            "\n\n--- SKILL PROMPT MODE ---\n"
            "The user wants a reusable skill/instruction block for AI assistants (injectable system-style skill), "
            "not a one-off chat reply.\n"
            "In [PROMPT], produce a complete skill definition: role, scope, rules, procedure, output format, "
            "edge cases. Use clear headings and bullet lists where helpful. "
            "If the user asked for a specific framework (e.g. Cursor, Claude), adapt section titles accordingly.\n"
            "The skill should be copy-paste ready and self-contained.\n"
            "--- END SKILL PROMPT MODE ---"
        )
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
    user_content = builder.build_user_content(
        combined_input,
        previous_agent_prompt=req.previous_prompt,
        task_classification=classification,
    )

    started_at = time.perf_counter()
    full_text = ""
    for chunk in llm.stream(
        system_prompt,
        user_content,
        req.gen_model,
        req.temperature,
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
        contract_sys = QUESTIONS_CONTRACT_SYSTEM.format(max_q=max_q)
        contract_user = (
            f"User task:\n{req.task_input.strip()}\n\n"
            f"Identified gaps to clarify:\n{missing}\n\n"
            f"Ask up to {max_q} targeted questions. Do not output [PROMPT]."
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
        },
        user_id=int(user["id"]),
    )

    if parsed.get("has_prompt"):
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
            metrics=metrics,
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
        "gen_model": req.gen_model,
        "target_model": req.target_model,
        "target_model_type": target_model_type.value,
        "metrics": metrics,
        "prompt_spec": prompt_spec,
        "evidence": evidence,
        "debug_issues": debug_issues,
        "intent_graph": intent_graph,
        "workspace": normalize_workspace(workspace),
        "session_id": session_id,
    }
