"""Prompt session history API."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from backend.deps import get_current_user, get_db
from db.manager import DBManager

router = APIRouter()


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
