from __future__ import annotations

from core.technique_registry import TechniqueRegistry
from db.manager import DBManager


def get_user_registry(db: DBManager, user_id: int) -> TechniqueRegistry:
    return TechniqueRegistry(extra_techniques=db.list_user_techniques(user_id))


def list_user_techniques_with_defaults(db: DBManager, user_id: int) -> list[dict]:
    registry = get_user_registry(db, user_id)
    items: list[dict] = []
    custom_by_id = {item.get("id"): item for item in db.list_user_techniques(user_id)}
    for technique in registry.get_all():
        item = dict(technique)
        custom = custom_by_id.get(item.get("id"))
        if custom:
            item["editable"] = True
            item["origin"] = "custom"
            item["db_id"] = custom.get("db_id")
        else:
            item["editable"] = False
            item["origin"] = "default"
            item["db_id"] = None
        items.append(item)
    return items
