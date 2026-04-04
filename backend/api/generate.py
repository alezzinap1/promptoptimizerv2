"""Prompt generation."""
from __future__ import annotations

import time
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

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
from core.workspace_profile import normalize_workspace
from db.manager import DBManager
from services.api_key_resolver import resolve_openrouter_api_key
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

    system_prompt = builder.build_system_prompt(
        technique_ids=technique_ids,
        target_model=req.target_model,
        domain=req.domain or "auto",
        questions_mode=req.questions_mode,
    )
    if req.prompt_type == "image":
        system_prompt += (
            "\n\n--- IMAGE PROMPT MODE ---\n"
            "The user wants a prompt for AI image generation (Midjourney, DALL-E, Stable Diffusion, etc.).\n"
            "Focus on visual description quality. Structure the output as:\n"
            "1. **Subject**: Main subject with specific visual details\n"
            "2. **Style**: Art style, medium, lighting, color palette\n"
            "3. **Composition**: Camera angle, framing, depth of field\n"
            "4. **Details**: Textures, materials, atmosphere, mood\n"
            "5. **Negative**: What to avoid (artifacts, distortions, etc.)\n"
            "Use descriptive, vivid language. Include technical parameters when relevant "
            "(aspect ratio, quality tags, etc.).\n"
            "--- END IMAGE PROMPT MODE ---"
        )
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
    gen_flags = diagnose_generation_response(parsed, questions)
    generation_issue: str | None = None
    if gen_flags["format_failure"]:
        generation_issue = "format_failure"
    elif gen_flags["questions_unparsed"]:
        generation_issue = "questions_unparsed"
    elif gen_flags["weak_question_options"]:
        generation_issue = "weak_question_options"
    metrics = analyze_prompt(parsed.get("prompt_block", ""), model_id=req.target_model) if parsed.get("has_prompt") else {}
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
        "techniques": [{"id": t["id"], "name": t.get("name", t["id"])} for t in techniques],
        "technique_ids": technique_ids,
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
