"""
Workspace management page for the Prompt IDE flow.

Workspaces are reusable prompt-design environments with glossary, style rules,
constraints, and reference snippets. They let users move from one-off prompts
to repeatable project contexts.
"""
from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

from app.config import DB_PATH
from app.shared_styles import inject_styles
from app.auth import get_current_user_id, require_auth
from db.manager import DBManager
from services.llm_client import TARGET_MODELS


@st.cache_resource
def load_db() -> DBManager:
    """Load the shared SQLite manager for workspace CRUD operations."""
    db = DBManager(db_path=DB_PATH)
    db.init()
    return db


def _lines(value: str) -> list[str]:
    """Convert a multiline text area into a clean list of entries."""
    return [line.strip() for line in value.splitlines() if line.strip()]


db = load_db()
current_user = require_auth(db)
user_id = get_current_user_id()
inject_styles()
st.title("Workspaces")
st.caption("Workspace хранит reusable контекст проекта: правила, глоссарий, ограничения и reference snippets.")

workspaces = db.list_workspaces(user_id=user_id)
top1, top2 = st.columns([3, 1])
with top1:
    st.markdown("Создай отдельные среды для разных типов prompt engineering: код, анализ, контент, брендовые сценарии.")
with top2:
    st.metric("Workspaces", len(workspaces))

with st.expander("Новый workspace", expanded=not bool(workspaces)):
    with st.form("new_workspace"):
        name = st.text_input("Название", placeholder="Напр. Python code review")
        description = st.text_area("Описание", placeholder="Для каких задач нужен этот workspace")
        preferred_target_model = st.selectbox(
            "Предпочтительная целевая модель",
            options=list(TARGET_MODELS.keys()),
            format_func=lambda x: TARGET_MODELS[x],
        )
        glossary = st.text_area("Глоссарий", placeholder="По одному термину на строку")
        style_rules = st.text_area("Style rules", placeholder="Напр. Кратко, строго, без маркетинговых формулировок")
        default_constraints = st.text_area("Default constraints", placeholder="Напр. Не придумывать факты")
        reference_snippets = st.text_area("Reference snippets", placeholder="Короткие выдержки, примеры, стандарты")

        if st.form_submit_button("Создать workspace", use_container_width=True, type="primary"):
            if not name.strip():
                st.error("Название обязательно.")
            else:
                db.create_workspace(
                    name=name,
                    description=description,
                    config={
                        "preferred_target_model": preferred_target_model,
                        "glossary": _lines(glossary),
                        "style_rules": _lines(style_rules),
                        "default_constraints": _lines(default_constraints),
                        "reference_snippets": _lines(reference_snippets),
                    },
                    user_id=user_id,
                )
                st.success("Workspace создан.")
                st.rerun()

if not workspaces:
    st.info("Workspaces пока не созданы. Можно работать и без них, но они нужны для Prompt IDE-режима.")
    st.stop()

for workspace in workspaces:
    cfg = workspace.get("config") or {}
    with st.container(border=True):
        hdr1, hdr2 = st.columns([4, 1])
        with hdr1:
            st.subheader(workspace["name"])
            if workspace.get("description"):
                st.caption(workspace["description"])
        with hdr2:
            if st.button("Активировать", key=f"use_ws_{workspace['id']}", use_container_width=True):
                st.session_state["sb_workspace_id"] = workspace["id"]
                st.success(f"Workspace '{workspace['name']}' активирован.")

        meta1, meta2, meta3 = st.columns(3)
        meta1.metric("Glossary", len(cfg.get("glossary") or []))
        meta2.metric("Constraints", len(cfg.get("default_constraints") or []))
        meta3.metric("Refs", len(cfg.get("reference_snippets") or []))

        with st.expander("Редактировать workspace"):
            with st.form(f"edit_workspace_{workspace['id']}"):
                edit_name = st.text_input("Название", value=workspace["name"])
                edit_description = st.text_area("Описание", value=workspace.get("description", ""))
                edit_target_model = st.selectbox(
                    "Предпочтительная целевая модель",
                    options=list(TARGET_MODELS.keys()),
                    index=list(TARGET_MODELS.keys()).index(cfg.get("preferred_target_model", "unknown")),
                    format_func=lambda x: TARGET_MODELS[x],
                    key=f"model_{workspace['id']}",
                )
                edit_glossary = st.text_area("Глоссарий", value="\n".join(cfg.get("glossary") or []))
                edit_style_rules = st.text_area("Style rules", value="\n".join(cfg.get("style_rules") or []))
                edit_constraints = st.text_area("Default constraints", value="\n".join(cfg.get("default_constraints") or []))
                edit_refs = st.text_area("Reference snippets", value="\n".join(cfg.get("reference_snippets") or []))

                c1, c2 = st.columns(2)
                if c1.form_submit_button("Сохранить", use_container_width=True):
                    db.update_workspace(
                        workspace["id"],
                        name=edit_name,
                        description=edit_description,
                        config={
                            "preferred_target_model": edit_target_model,
                            "glossary": _lines(edit_glossary),
                            "style_rules": _lines(edit_style_rules),
                            "default_constraints": _lines(edit_constraints),
                            "reference_snippets": _lines(edit_refs),
                        },
                        user_id=user_id,
                    )
                    st.success("Workspace обновлён.")
                    st.rerun()
                if c2.form_submit_button("Удалить", use_container_width=True):
                    db.delete_workspace(workspace["id"], user_id=user_id)
                    if st.session_state.get("sb_workspace_id") == workspace["id"]:
                        st.session_state["sb_workspace_id"] = 0
                    st.success("Workspace удалён.")
                    st.rerun()
