"""Prompt session history API."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.deps import get_current_user, get_db
from db.manager import DBManager
from services.llm_client import DEFAULT_PROVIDER

router = APIRouter()


class ApplyPromptRequest(BaseModel):
    final_prompt: str = Field("", max_length=128000)
    copy_metadata_from_version: int | None = None


@router.get("/sessions/{session_id}/versions")
def get_session_versions(
    session_id: str,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    return {"items": db.get_session_versions(session_id, user_id=int(user["id"]))}


@router.get("/sessions/{session_id}/latest")
def get_latest_version(
    session_id: str,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    return {"item": db.get_latest_version(session_id, user_id=int(user["id"]))}


@router.get("/sessions/{session_id}/prompt-spec")
def get_latest_prompt_spec(
    session_id: str,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    return {"item": db.get_latest_prompt_spec(session_id, user_id=int(user["id"]))}


@router.post("/sessions/{session_id}/apply-prompt")
def apply_session_prompt(
    session_id: str,
    req: ApplyPromptRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    """Сохранить новую версию промпта в той же сессии (копия метаданных с выбранной или последней версии)."""
    uid = int(user["id"])
    final = (req.final_prompt or "").strip()
    if not final:
        raise HTTPException(400, "Пустой промпт.")
    versions = db.get_session_versions(session_id, user_id=uid)
    if not versions:
        raise HTTPException(404, "Сессия не найдена.")
    src = versions[-1]
    if req.copy_metadata_from_version is not None:
        want = int(req.copy_metadata_from_version)
        for v in versions:
            if int(v.get("version") or 0) == want:
                src = v
                break
    metrics = dict(src.get("metrics") or {})
    metrics["preview_edit_applied"] = True
    db.save_prompt_version(
        session_id=session_id,
        task_input=str(src.get("task_input") or ""),
        task_types=src.get("task_types") or ["general"],
        complexity=str(src.get("complexity") or "medium"),
        target_model=str(src.get("target_model") or "unknown"),
        gen_model=str(src.get("gen_model") or DEFAULT_PROVIDER),
        techniques_used=src.get("techniques_used") or [],
        reasoning=str(src.get("reasoning") or ""),
        final_prompt=final,
        metrics=metrics,
        user_id=uid,
    )
    latest = db.get_latest_version(session_id, user_id=uid)
    return {"ok": True, "item": latest}
