"""Workspace CRUD API."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.deps import get_current_user, get_db
from db.manager import DBManager
from core.workspace_profile import normalize_workspace

router = APIRouter()


def _serialize_workspace(workspace: dict) -> dict:
    return normalize_workspace(workspace)


class WorkspacePayload(BaseModel):
    name: str
    description: str = ""
    preferred_target_model: str = "unknown"
    glossary: list[str] = []
    style_rules: list[str] = []
    default_constraints: list[str] = []
    reference_snippets: list[str] = []

    def to_config(self) -> dict:
        return {
            "preferred_target_model": self.preferred_target_model,
            "glossary": self.glossary,
            "style_rules": self.style_rules,
            "default_constraints": self.default_constraints,
            "reference_snippets": self.reference_snippets,
        }


class WorkspaceUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    preferred_target_model: str | None = None
    glossary: list[str] | None = None
    style_rules: list[str] | None = None
    default_constraints: list[str] | None = None
    reference_snippets: list[str] | None = None


@router.get("/workspaces")
def list_workspaces(
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    items = db.list_workspaces(user_id=int(user["id"]))
    return {"items": [_serialize_workspace(item) for item in items]}


@router.post("/workspaces")
def create_workspace(
    req: WorkspacePayload,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    if not req.name.strip():
        raise HTTPException(400, "Workspace name is required")
    workspace_id = db.create_workspace(
        name=req.name,
        description=req.description,
        config=req.to_config(),
        user_id=int(user["id"]),
    )
    workspace = db.get_workspace(workspace_id, user_id=int(user["id"]))
    return {"item": _serialize_workspace(workspace or {})}


@router.get("/workspaces/{workspace_id}")
def get_workspace(
    workspace_id: int,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    workspace = db.get_workspace(workspace_id, user_id=int(user["id"]))
    if not workspace:
        raise HTTPException(404, "Workspace not found")
    return {"item": _serialize_workspace(workspace)}


@router.patch("/workspaces/{workspace_id}")
def update_workspace(
    workspace_id: int,
    req: WorkspaceUpdate,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    existing = db.get_workspace(workspace_id, user_id=int(user["id"]))
    if not existing:
        raise HTTPException(404, "Workspace not found")
    cfg = dict((existing.get("config") or {}))
    for field in ("preferred_target_model", "glossary", "style_rules", "default_constraints", "reference_snippets"):
        value = getattr(req, field)
        if value is not None:
            cfg[field] = value
    db.update_workspace(
        workspace_id,
        name=req.name,
        description=req.description,
        config=cfg,
        user_id=int(user["id"]),
    )
    updated = db.get_workspace(workspace_id, user_id=int(user["id"]))
    return {"item": _serialize_workspace(updated or {})}


@router.delete("/workspaces/{workspace_id}")
def delete_workspace(
    workspace_id: int,
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    db.delete_workspace(workspace_id, user_id=int(user["id"]))
    return {"ok": True}
