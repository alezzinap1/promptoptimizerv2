"""Prompt IDE preview API."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.deps import get_current_user, get_db, get_registry_for_user
from core.workspace_profile import normalize_workspace
from db.manager import DBManager
from services.prompt_workflow import apply_evidence_decisions, build_preview_payload

router = APIRouter()


class PromptIdePreviewRequest(BaseModel):
    task_input: str
    target_model: str = "unknown"
    workspace_id: int | None = None
    previous_prompt: str | None = None
    technique_mode: str = "auto"
    manual_techs: list[str] = []
    overrides: dict | None = None
    evidence_decisions: dict | None = None
    prompt_type: str = "text"


@router.post("/prompt-ide/preview")
def preview_prompt_ide(
    req: PromptIdePreviewRequest,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
    registry = Depends(get_registry_for_user),
):
    workspace = None
    if req.workspace_id:
        workspace = db.get_workspace(req.workspace_id, user_id=int(user["id"]))
    effective_overrides = apply_evidence_decisions(req.overrides, req.evidence_decisions)
    result = build_preview_payload(
        raw_input=req.task_input,
        target_model=req.target_model,
        workspace=workspace,
        previous_prompt=req.previous_prompt,
        overrides=effective_overrides,
        registry=registry,
        technique_mode=req.technique_mode,
        manual_techs=req.manual_techs,
        prompt_type=req.prompt_type or "text",
    )
    result["workspace"] = normalize_workspace(workspace)
    return result
