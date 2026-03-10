"""
Prompt Library page — search, filter, manage and export saved prompts.
Grid layout: 3 cards per row.
"""
from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

from db.manager import DBManager
from core.quality_metrics import analyze_prompt
from services.llm_client import TARGET_MODELS
from app.shared_styles import inject_styles
TASK_TYPE_LABELS = {
    "code":              "Код",
    "analysis":          "Анализ",
    "creative":          "Творческий",
    "writing":           "Редактура",
    "structured_output": "Структурированный",
    "transformation":    "Трансформация",
    "instruction":       "Инструкция",
    "debugging":         "Отладка",
    "decision_making":   "Решения",
    "research":          "Исследование",
    "data_analysis":     "Данные",
    "general":           "Общая",
}


@st.cache_resource
def load_db() -> DBManager:
    db = DBManager()
    db.init()
    return db


db = load_db()
stats = db.get_library_stats()

inject_styles()

# ── Header ─────────────────────────────────────────────────────────────────────
hdr1, hdr2 = st.columns([3, 1])
with hdr1:
    st.title("Библиотека промптов")
with hdr2:
    st.metric("Промптов", stats["total"])

# ── Filters bar ────────────────────────────────────────────────────────────────
with st.expander("Поиск и фильтры", expanded=False):
    fc1, fc2, fc3 = st.columns(3)
    search = fc1.text_input("Поиск по тексту", placeholder="анализ, финансы...")

    target_filter_opts = {"all": "Все модели"} | {
        k: v for k, v in TARGET_MODELS.items() if k in (stats.get("models") or [])
    }
    target_filter = fc2.selectbox(
        "Целевая модель",
        options=list(target_filter_opts.keys()),
        format_func=lambda x: target_filter_opts[x],
    )

    type_filter_opts = {"all": "Все типы"} | {
        k: TASK_TYPE_LABELS.get(k, k) for k in (stats.get("task_types") or [])
    }
    type_filter = fc3.selectbox(
        "Тип задачи",
        options=list(type_filter_opts.keys()),
        format_func=lambda x: type_filter_opts[x],
    )

items = db.get_library(
    target_model=target_filter if target_filter != "all" else None,
    task_type=type_filter if type_filter != "all" else None,
    search=search if search else None,
)

if not items:
    st.info("Библиотека пуста. Создайте промпт на главной странице и нажмите **В библиотеку**.")
    st.stop()

# ── Export + count ──────────────────────────────────────────────────────────────
exp_col, cnt_col = st.columns([1, 3])
with exp_col:
    all_text = "\n\n" + "=" * 60 + "\n\n".join(
        f"# {item['title']}\n"
        f"# Модель: {TARGET_MODELS.get(item['target_model'], item['target_model'])}\n"
        f"# Теги: {', '.join(item['tags'])}\n\n"
        f"{item['prompt']}"
        for item in items
    )
    st.download_button(
        f"Экспорт всех ({len(items)})",
        data=all_text,
        file_name="prompt_library.txt",
        mime="text/plain",
        use_container_width=True,
    )

st.divider()

# ── Grid: 3 cards per row ──────────────────────────────────────────────────────
for row_start in range(0, len(items), 3):
    row_items = items[row_start : row_start + 3]
    cols = st.columns(3, gap="medium")

    for col, item in zip(cols, row_items):
        target_label = TARGET_MODELS.get(item["target_model"], item["target_model"])
        type_label   = TASK_TYPE_LABELS.get(item["task_type"], item["task_type"])
        tags_str     = " · ".join(f"`{t}`" for t in item["tags"]) if item["tags"] else ""
        techs_str    = ", ".join(item.get("techniques") or [])
        rating       = item.get("rating", 0)
        stars        = f"{rating}/5"

        with col:
            with st.container(border=True):
                # ── Card header ────────────────────────────────────────────────
                st.markdown(f"**{item['title'][:48]}**")
                st.caption(f"{target_label} · {type_label}")
                st.markdown(f"<small>{stars}</small>", unsafe_allow_html=True)

                # ── Tags ───────────────────────────────────────────────────────
                if tags_str:
                    st.caption(tags_str)

                # ── Quick metrics ──────────────────────────────────────────────
                m = analyze_prompt(item["prompt"])
                score = m.get("completeness_score", m.get("quality_score", 0))
                mc1, mc2, mc3 = st.columns(3)
                mc1.metric("Токены", m["token_estimate"])
                mc2.metric("Инстр.", m["instruction_count"])
                mc3.metric("Score", f"{score:.0f}%")

                # ── Actions ────────────────────────────────────────────────────
                ac1, ac2, ac3 = st.columns(3)
                with ac1:
                    st.download_button(
                        "Скачать",
                        data=item["prompt"],
                        file_name=f"prompt_{item['id']}.txt",
                        mime="text/plain",
                        use_container_width=True,
                        key=f"dl_{item['id']}",
                        help="Скачать промпт",
                    )
                with ac2:
                    if st.button("Открыть", key=f"open_{item['id']}", use_container_width=True, help="Открыть в инженере"):
                        st.session_state["prefill_task"] = f"Улучши этот промпт:\n\n{item['prompt']}"
                        st.switch_page("Home.py")
                with ac3:
                    if st.button("Удалить", key=f"del_{item['id']}", use_container_width=True, help="Удалить"):
                        db.delete_from_library(item["id"])
                        st.rerun()

                # ── Full prompt + edit (collapsed) ─────────────────────────────
                with st.expander("Промпт / Правка"):
                    st.code(item["prompt"], language=None)

                    # Rating
                    new_rating = st.select_slider(
                        "Оценка",
                        options=[0, 1, 2, 3, 4, 5],
                        value=rating,
                        key=f"rating_{item['id']}",
                        format_func=lambda x: f"{x}/5",
                    )
                    if new_rating != rating:
                        db.update_library_item(item["id"], rating=new_rating)
                        st.rerun()

                    if item.get("notes"):
                        st.markdown(f"*{item['notes']}*")
                    if techs_str:
                        st.caption(f"Техники: {techs_str}")

                    with st.form(f"edit_{item['id']}"):
                        new_title = st.text_input("Название", value=item["title"])
                        new_tags  = st.text_input("Теги", value=", ".join(item["tags"]))
                        new_notes = st.text_area("Заметки", value=item.get("notes", ""), height=50)
                        if st.form_submit_button("Сохранить", use_container_width=True):
                            db.update_library_item(
                                item["id"],
                                title=new_title,
                                tags=[t.strip() for t in new_tags.split(",") if t.strip()],
                                notes=new_notes,
                            )
                            st.success("Обновлено")
                            st.rerun()
