"""Metrics and events API."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from backend.deps import get_current_user, get_db
from db.manager import DBManager

router = APIRouter()


@router.get("/metrics/summary")
def get_metrics_summary(
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    return db.get_product_metrics_summary(user_id=int(user["id"]))


@router.get("/metrics/events")
def get_metrics_events(
    limit: int = Query(25, ge=1, le=200),
    user: dict = Depends(get_current_user),
    db: DBManager = Depends(get_db),
):
    return {"items": db.get_recent_events(limit=limit, user_id=int(user["id"]))}
