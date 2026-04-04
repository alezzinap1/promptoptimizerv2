"""Skills CRUD + LLM-based skill generation."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.deps import get_current_user, get_db
from db.manager import DBManager
from services.llm_client import LLMClient, PROVIDER_MODELS
from services.api_key_resolver import resolve_openrouter_api_key

router = APIRouter()

SKILL_GEN_SYSTEM_PROMPT = """You are a senior prompt engineer who designs reusable "skills" for AI assistants (ChatGPT, Claude, Cursor, custom agents).

A skill is not a one-shot user message: it is a durable instruction block the host injects so the model consistently behaves in a specialized way.

Given the user's short description, produce ONE complete skill.

## Output format (exactly this structure, no outer markdown fences)

---
name: <short title, max ~80 chars>
description: <one or two sentences: who it helps and what outcome they get>
tags: <comma-separated keywords for search, lowercase, English or same language as user>
---

## Role & scope
<what persona the model adopts, what is in/out of scope>

## Operating principles
<3–7 bullet-level rules: tone, safety, when to ask clarifying questions, when to refuse>

## Procedure
<numbered or clear steps the model follows when the skill is active>

## Output contract
<exactly what the user receives: sections, format, length, code vs prose, language>

## Quality checklist (self-check before answering)
<what the model must verify before sending the final reply>

## Edge cases
<ambiguity, missing data, conflicting instructions — how to handle>

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
    id_ = db.create_skill(
        user_id=int(user["id"]),
        name=req.name,
        body=req.body,
        description=req.description,
        category=req.category,
    )
    return {"id": id_}


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
