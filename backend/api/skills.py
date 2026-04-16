"""Skills CRUD + LLM-based skill generation."""
from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from config.abuse import check_input_size
from config.settings import TRIAL_MAX_COMPLETION_PER_M
from backend.deps import check_user_rate_limit, get_current_user, get_db, get_session_id
from services.trial_budget import effective_trial_tokens_limit
from db.manager import DBManager
from services.llm_client import LLMClient, DEFAULT_PROVIDER, PROVIDER_MODELS
from services.api_key_resolver import resolve_openrouter_api_key
from services.openrouter_models import completion_price_per_m, get_model_pricing
from services.user_preferences import get_user_preferences_payload

router = APIRouter()


def _get_openrouter_model_id(provider: str) -> str:
    if provider in PROVIDER_MODELS:
        return PROVIDER_MODELS[provider]
    return provider if "/" in provider else provider

SKILL_GEN_SYSTEM_PROMPT = """You are a senior prompt engineer who designs reusable "skills" for AI assistants (ChatGPT, Claude, Cursor, custom agents).

A skill is not a one-shot user message: it is a durable instruction block the host injects so the model consistently behaves in a specialized way.

Given the user's short description, produce ONE complete skill.

## Output format (exactly this structure, no outer markdown fences)

YAML frontmatter compatible with prompts.chat / skills-style agents:

---
name: <short title, max ~80 chars>
description: <1–2 sentences: when the agent should auto-use this skill; who it helps>
version: 1.0
tags: <comma-separated keywords, lowercase, same language as user where possible>
target_agents: <e.g. claude-code, cursor, windsurf — or "universal">
---

# <Skill title>

## Role & mission
<who the agent becomes; scope in/out>

## When to use this skill
<triggers and scenarios — must answer "when should I load this skill?">

## Core competencies
<what the agent can do in this domain>

## Core rules & constraints
<non-negotiable behaviour; concrete verbs: "always validate X", not "be careful">

## Process & approach
<step-by-step methodology when the domain has a clear workflow>

## Output format
<expected structure of agent outputs>

## Anti-patterns (do NOT)
<common failure modes — explicit>

## Edge cases
<ambiguity, missing data, conflicts — how to handle>

## Examples
<1–2 short realistic good examples>

## Optional: mini example
<one short fictional example of input → excerpt of good output — only if it clarifies format>

## Rules
- Total length: about 350–700 words unless the user asked for something trivial (then shorter).
- Match the user's language for name, description, and body (if they wrote in Russian, write in Russian).
- Prefer concrete, testable instructions over vague advice.
- Do NOT wrap the entire output in ``` markdown fences.
- Do NOT mention "as an AI language model" or system prompts."""


class CreateSkillRequest(BaseModel):
    name: str
    body: str
    description: str = ""
    category: str = "general"
    client_local_id: str | None = Field(default=None, max_length=200)


class BulkSkillItem(BaseModel):
    local_id: str = Field(..., max_length=200)
    name: str
    body: str
    description: str = ""
    category: str = "general"
    updated_at: str = ""


class BulkUpsertSkillsRequest(BaseModel):
    items: list[BulkSkillItem] = Field(default_factory=list, max_length=500)


@router.get("/skills")
def list_skills(
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    return {"items": db.list_skills(user_id=int(user["id"]))}


@router.post("/skills")
def create_skill(
    req: CreateSkillRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    if req.client_local_id and req.client_local_id.strip():
        id_ = db.create_skill_with_client_id(
            user_id=int(user["id"]),
            name=req.name,
            body=req.body,
            description=req.description,
            category=req.category,
            client_local_id=req.client_local_id.strip(),
        )
    else:
        id_ = db.create_skill(
            user_id=int(user["id"]),
            name=req.name,
            body=req.body,
            description=req.description,
            category=req.category,
        )
    return {"id": id_}


@router.post("/skills/bulk-upsert")
def bulk_upsert_skills(
    req: BulkUpsertSkillsRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    items = [it.model_dump() for it in req.items]
    out = db.bulk_upsert_skills(int(user["id"]), items)
    return {"ok": True, **out}


@router.get("/skills/{skill_id}")
def get_skill(
    skill_id: int,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    item = db.get_skill(skill_id, user_id=int(user["id"]))
    if not item:
        return {"error": "not_found"}
    return {"item": item}


class UpdateSkillRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    body: str | None = None
    category: str | None = None


@router.patch("/skills/{skill_id}")
def update_skill(
    skill_id: int,
    req: UpdateSkillRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    db.update_skill(
        skill_id, user_id=int(user["id"]),
        name=req.name, description=req.description,
        body=req.body, category=req.category,
    )
    return {"ok": True}


@router.delete("/skills/{skill_id}")
def delete_skill(
    skill_id: int,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    db.delete_skill(skill_id, user_id=int(user["id"]))
    return {"ok": True}


class GenerateSkillRequest(BaseModel):
    description: str
    gen_model: str = ""


class SkillSandboxRequest(BaseModel):
    skill_body: str = Field("", max_length=200_000)
    user_message: str = Field("", max_length=32_000)
    gen_model: str | None = None


class SkillSandboxResponse(BaseModel):
    reply: str
    gen_model: str


@router.post("/skills/sandbox/chat", response_model=SkillSandboxResponse)
def skill_sandbox_chat(
    req: SkillSandboxRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
    auth_session_id: str | None = Depends(get_session_id),
):
    """Один раунд чата: system = текст скилла, user = сообщение (песочница)."""
    body = (req.skill_body or "").strip()
    msg = (req.user_message or "").strip()
    if not body:
        raise HTTPException(400, "Пустой skill_body.")
    if not msg:
        raise HTTPException(400, "Пустое сообщение.")
    blob = f"{body}\n{msg}"
    ok, err = check_input_size(blob)
    if not ok:
        raise HTTPException(400, err)
    ok, err = check_user_rate_limit(db, int(user["id"]), auth_session_id)
    if not ok:
        raise HTTPException(429, err)

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
                f"Пробный лимит ({lim:,} токенов) исчерпан. Введите свой API ключ OpenRouter в Настройках.",
            )

    payload = get_user_preferences_payload(db, user_id)
    gen_list = payload.get("preferred_generation_models") or []
    gen_model = (req.gen_model or "").strip() or (gen_list[0] if gen_list else DEFAULT_PROVIDER)
    if using_host_key:
        model_id = _get_openrouter_model_id(gen_model)
        if completion_price_per_m(model_id) > TRIAL_MAX_COMPLETION_PER_M:
            raise HTTPException(
                403,
                f"Модель недоступна в пробном режиме (выход >${TRIAL_MAX_COMPLETION_PER_M}/1M). "
                "Введите свой API ключ в Настройках.",
            )

    llm = LLMClient(api_key, timeout=90.0)
    started = time.perf_counter()
    reply = llm.generate(
        system_prompt=body,
        user_content=msg,
        provider=gen_model,
        temperature=0.5,
        top_p=0.95,
        max_tokens=2048,
    )
    reply = (reply or "").strip()
    if not reply:
        raise HTTPException(502, "Пустой ответ модели.")

    if using_host_key:
        prompt_tokens = int(len(body + msg) // 4) + 80
        completion_tokens = max(0, len(reply) // 4)
        total_tokens = prompt_tokens + completion_tokens
        mid = _get_openrouter_model_id(gen_model)
        pp, cp = get_model_pricing(mid)
        cost = (prompt_tokens * pp) + (completion_tokens * cp)
        db.add_user_usage(user_id, total_tokens, cost)

    db.log_event(
        "skill_sandbox_chat",
        session_id=auth_session_id or "",
        payload={"gen_model": gen_model, "latency_ms": round((time.perf_counter() - started) * 1000, 1)},
        user_id=user_id,
    )
    return SkillSandboxResponse(reply=reply, gen_model=gen_model)


@router.post("/skills/generate")
def generate_skill(
    req: GenerateSkillRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    user_key = db.get_user_openrouter_api_key(int(user["id"]))
    api_key = resolve_openrouter_api_key(user_key)
    if not api_key:
        return {"error": "no_api_key"}
    llm = LLMClient(api_key=api_key)
    provider = req.gen_model or PROVIDER_MODELS.get("gemini_flash", "google/gemini-flash-1.5")
    result = llm.generate(
        system_prompt=SKILL_GEN_SYSTEM_PROMPT,
        user_content=req.description,
        provider=provider,
        temperature=0.7,
    )
    return {"generated_body": result}
