"""Prompt library CRUD + evaluation."""
from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.deps import get_current_user, get_db
from config.settings import TRIAL_MAX_COMPLETION_PER_M
from services.trial_budget import effective_trial_tokens_limit
from core.quality_metrics import analyze_prompt
from db.manager import DBManager
from services import translator
from services.api_key_resolver import resolve_openrouter_api_key
from services.llm_client import LLMClient, DEFAULT_PROVIDER, PROVIDER_MODELS
from services.openrouter_models import completion_price_per_m, get_model_pricing

router = APIRouter()


@router.get("/library")
def list_library(
    target_model: str | None = None,
    task_type: str | None = None,
    search: str | None = None,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    items = db.get_library(
        target_model=target_model,
        task_type=task_type,
        search=search,
        user_id=int(user["id"]),
    )
    return {"items": items}


@router.get("/library/stats")
def library_stats(
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    return db.get_library_stats(user_id=int(user["id"]))


class SaveToLibraryRequest(BaseModel):
    title: str
    prompt: str
    tags: list[str] = []
    target_model: str = "unknown"
    task_type: str = "general"
    techniques: list[str] = []
    notes: str = ""
    cover_image_path: str = ""


@router.post("/library")
def save_to_library(
    req: SaveToLibraryRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    id_ = db.save_to_library(
        title=req.title,
        prompt=req.prompt,
        tags=req.tags,
        target_model=req.target_model,
        task_type=req.task_type,
        techniques=req.techniques,
        notes=req.notes,
        user_id=int(user["id"]),
        cover_image_path=(req.cover_image_path or "").strip() or None,
    )
    return {"id": id_}


class UpdateLibraryRequest(BaseModel):
    title: str | None = None
    prompt: str | None = None
    tags: list[str] | None = None
    notes: str | None = None
    rating: int | None = None
    cover_image_path: str | None = None


@router.patch("/library/{item_id}")
def update_library(
    item_id: int,
    req: UpdateLibraryRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    db.update_library_item(
        item_id,
        title=req.title,
        prompt=req.prompt,
        tags=req.tags,
        notes=req.notes,
        rating=req.rating,
        cover_image_path=req.cover_image_path,
        user_id=int(user["id"]),
    )
    return {"ok": True}


def _or_model_id(provider: str) -> str:
    if provider in PROVIDER_MODELS:
        return PROVIDER_MODELS[provider]
    return provider if "/" in provider else provider


class LlmReviewRequest(BaseModel):
    prompt: str
    prompt_type: str = "text"
    original_task: str = ""
    judge_model: str | None = None


class LlmReviewResponse(BaseModel):
    review: str
    judge_model: str


@router.post("/library/llm-review", response_model=LlmReviewResponse)
def llm_review_prompt(
    req: LlmReviewRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    prompt = (req.prompt or "").strip()
    if not prompt:
        raise HTTPException(400, "Пустой prompt.")
    user_id = int(user["id"])
    user_key = db.get_user_openrouter_api_key(user_id)
    api_key = resolve_openrouter_api_key(user_key)
    if not api_key:
        raise HTTPException(500, "Нет ключа OpenRouter.")
    using_host_key = not bool(user_key)
    if using_host_key:
        usage = db.get_user_usage(user_id)
        lim = effective_trial_tokens_limit(usage)
        if usage["tokens_used"] >= lim:
            raise HTTPException(402, "Пробный лимит исчерпан.")

    gen = (req.judge_model or "").strip() or DEFAULT_PROVIDER
    mid = _or_model_id(gen)
    if using_host_key and completion_price_per_m(mid) > TRIAL_MAX_COMPLETION_PER_M:
        gen = "gemini_flash"
        mid = _or_model_id(gen)

    pt = (req.prompt_type or "text").strip().lower()
    task = (req.original_task or "").strip()
    if pt == "image":
        sys = (
            "Ты эксперт по промптам для генерации изображений. Кратко (на русском) оцени промпт: "
            "ясность сцены, свет, композиция, стиль, негативы, соотношение сторон, типичные риски. "
            "3–8 коротких буллетов + одна строка «Итог». Без вежливых вступлений."
        )
    elif pt == "skill":
        sys = (
            "Ты ревьюер SKILL-инструкций для LLM. На русском: ROLE/SCOPE/RULES, границы, инструменты, "
            "противоречия, пробелы. 3–8 буллетов + «Итог»."
        )
    else:
        sys = (
            "Ты ревьюер текстовых промптов. На русском: цель, аудитория, формат, ограничения, ясность шагов, риски. "
            "3–8 буллетов + «Итог»."
        )
    user_block = f"Исходная задача пользователя (если есть):\n{task}\n\nПромпт:\n{prompt}"
    llm = LLMClient(api_key, timeout=90.0)
    started = time.perf_counter()
    review = llm.generate(sys, user_block, gen, temperature=0.35, max_tokens=1200)
    review = (review or "").strip()
    if not review:
        raise HTTPException(502, "Пустой ответ судьи.")
    if using_host_key:
        ptoks = len(sys + user_block) // 4 + 60
        ctoks = len(review) // 4
        pp, cp = get_model_pricing(_or_model_id(gen))
        db.add_user_usage(user_id, ptoks + ctoks, ptoks * pp + ctoks * cp)
    db.log_event(
        "library_llm_review",
        session_id="",
        payload={"prompt_type": pt, "latency_ms": round((time.perf_counter() - started) * 1000, 1)},
        user_id=user_id,
    )
    return LlmReviewResponse(review=review, judge_model=_or_model_id(gen))


class LibraryTranslateResponse(BaseModel):
    id: int
    prompt: str
    prompt_lang: str
    prompt_alt: str
    prompt_alt_lang: str
    provider: str


@router.post("/library/{item_id}/translate", response_model=LibraryTranslateResponse)
def translate_library_item(
    item_id: int,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    """
    Перевести сохранённый промпт (RU↔EN, авто-направление) и сохранить альт-версию
    рядом с оригиналом. Использует бесплатный `services.translator` (без LLM).
    """
    user_id = int(user["id"])
    item = db.get_library_item(item_id, user_id=user_id)
    if not item:
        raise HTTPException(404, "Промпт не найден.")
    source = str(item.get("prompt") or "").strip()
    if not source:
        raise HTTPException(400, "В промпте нет текста.")

    try:
        result = translator.translate(source, "auto")
    except RuntimeError as exc:
        raise HTTPException(503, f"Перевод временно недоступен: {exc}") from exc

    direction = str(result["direction"])  # ru->en | en->ru
    src_lang = "ru" if direction == "ru->en" else "en"
    tgt_lang = "en" if direction == "ru->en" else "ru"

    db.set_prompt_library_translation(
        item_id,
        prompt_lang=src_lang,
        prompt_alt=str(result["translated"] or ""),
        prompt_alt_lang=tgt_lang,
        user_id=user_id,
    )
    db.log_event(
        "library_translate",
        session_id="",
        payload={
            "item_id": item_id,
            "direction": direction,
            "provider": result.get("provider"),
            "chars_in": len(source),
            "chars_out": len(str(result["translated"] or "")),
        },
        user_id=user_id,
    )
    return LibraryTranslateResponse(
        id=item_id,
        prompt=source,
        prompt_lang=src_lang,
        prompt_alt=str(result["translated"] or ""),
        prompt_alt_lang=tgt_lang,
        provider=str(result.get("provider") or "unknown"),
    )


@router.delete("/library/{item_id}")
def delete_from_library(
    item_id: int,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    db.delete_from_library(item_id, user_id=int(user["id"]))
    return {"ok": True}


class EvaluatePromptRequest(BaseModel):
    prompt: str
    target_model: str = ""
    prompt_type: str = "text"


@router.post("/library/evaluate")
def evaluate_prompt(
    req: EvaluatePromptRequest,
    user: dict = Depends(get_current_user),
):
    """Evaluate a prompt's quality without saving it."""
    metrics = analyze_prompt(
        req.prompt,
        req.target_model,
        prompt_type=req.prompt_type or "text",
        task_input=None,
    )
    return {"metrics": metrics}
