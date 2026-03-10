"""
Techniques reference page — browse the knowledge base of prompting techniques.
Grid layout: 2 cards per row.
"""
from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

from core.technique_registry import TechniqueRegistry
from app.shared_styles import inject_styles
@st.cache_resource
def load_registry() -> TechniqueRegistry:
    return TechniqueRegistry()


registry = load_registry()
all_techs = registry.get_all()

inject_styles()
st.title("База знаний техник промптинга")

# ── Filter bar ────────────────────────────────────────────────────────────────
fc1, fc2, fc3 = st.columns(3)
with fc1:
    search_tech = st.text_input(
        "Поиск",
        placeholder="chain of thought, роль, ограничения...",
    )
with fc2:
    task_types_filter = st.multiselect(
        "Тип задачи",
        options=["code", "analysis", "creative", "writing", "debugging",
                 "decision_making", "research", "instruction", "data_analysis"],
        format_func=lambda x: {
            "code": "Код", "analysis": "Анализ", "creative": "Творческий",
            "writing": "Редактура", "debugging": "Отладка",
            "decision_making": "Решения", "research": "Исследование",
            "instruction": "Инструкция", "data_analysis": "Данные",
        }.get(x, x),
    )
with fc3:
    complexity_filter = st.select_slider(
        "Сложность",
        options=["any", "low", "medium", "high"],
        value="any",
    )

# ── Filter techniques ──────────────────────────────────────────────────────────
PRIORITY_LABELS = {
    1: "Базовая", 2: "Важная", 3: "Продвинутая",
    4: "Специализированная", 5: "Экспертная",
}
COMPLEXITY_LABELS = {"low": "Простые", "medium": "Средние", "high": "Сложные"}
TYPE_LABELS = {
    "code": "Код", "analysis": "Анализ", "creative": "Творческий",
    "writing": "Редактура", "debugging": "Отладка",
    "decision_making": "Решения", "research": "Исследование",
    "instruction": "Инструкция", "data_analysis": "Данные",
}

filtered: list[dict] = []
for tech in sorted(all_techs, key=lambda t: t.get("priority", 99)):
    name = tech.get("name", tech["id"])
    when = tech.get("when_to_use", {})
    t_types = when.get("task_types", [])
    compl = when.get("complexity", [])
    why = tech.get("why_it_works", "").strip()

    if search_tech:
        hay = (name + why + tech.get("id", "")).lower()
        if search_tech.lower() not in hay:
            continue
    if task_types_filter:
        if not any(tt in t_types for tt in task_types_filter):
            continue
    if complexity_filter != "any":
        if complexity_filter not in compl:
            continue
    filtered.append(tech)

st.caption(f"Техник: {len(filtered)} из {len(all_techs)}")
st.divider()

if not filtered:
    st.info("Ни одна техника не соответствует фильтрам. Попробуй изменить параметры поиска.")
    st.stop()

# ── Grid: 2 cards per row ──────────────────────────────────────────────────────
for row_start in range(0, len(filtered), 2):
    row_techs = filtered[row_start : row_start + 2]
    cols = st.columns(2, gap="medium")

    for col, tech in zip(cols, row_techs):
        name = tech.get("name", tech["id"])
        when = tech.get("when_to_use", {})
        t_types = when.get("task_types", [])
        compl = when.get("complexity", [])
        why = tech.get("why_it_works", "").strip()
        priority_label = PRIORITY_LABELS.get(tech.get("priority", 9), "")
        not_for = when.get("not_for", [])
        compat = tech.get("compatibility", {})
        combines = compat.get("combines_well_with", [])
        variants = tech.get("variants", [])
        core_pattern = tech.get("core_pattern", "")
        examples = tech.get("examples", {})
        good_examples = examples.get("good", [])
        anti = tech.get("anti_patterns", [])
        pattern_text = core_pattern or (variants[0].get("pattern", "") if variants else "")

        with col:
            with st.container(border=True):
                # ── Card header ────────────────────────────────────────────────
                hc1, hc2 = st.columns([3, 1])
                with hc1:
                    st.markdown(f"**{name}**")
                with hc2:
                    st.caption(priority_label)

                # ── Quick meta ─────────────────────────────────────────────────
                if t_types:
                    st.caption("· ".join(TYPE_LABELS.get(tt, tt) for tt in t_types[:4]))
                if compl:
                    st.caption("Сложность: " + " / ".join(COMPLEXITY_LABELS.get(c, c) for c in compl))

                # ── Why it works snippet ───────────────────────────────────────
                if why:
                    snippet = why[:160] + ("…" if len(why) > 160 else "")
                    st.markdown(f"<small>{snippet}</small>", unsafe_allow_html=True)

                # ── Details expander ───────────────────────────────────────────
                with st.expander("Подробнее"):
                    if not_for:
                        st.caption("Не для: " + ", ".join(not_for))
                    if combines:
                        st.markdown("**Сочетается с:** " + ", ".join(combines))
                    if why:
                        st.markdown(f"**Почему работает:**\n{why}")
                    if core_pattern:
                        st.markdown("**Базовый шаблон:**")
                        st.code(core_pattern, language=None)
                    if variants:
                        st.markdown("**Варианты:**")
                        for v in variants:
                            cost = v.get("cost_tokens", "?")
                            when_v = v.get("use_when", "")
                            with st.expander(f"{v.get('name', '—')} · {cost} токенов"):
                                if when_v:
                                    st.caption(f"Применять: {when_v}")
                                pattern = v.get("pattern", "")
                                if pattern:
                                    st.code(pattern, language=None)
                    if good_examples:
                        st.markdown("**Пример:**")
                        ex = good_examples[0]
                        st.write(f"*Запрос:* {ex.get('input', '')}")
                        out = ex.get("output", "")
                        if out:
                            with st.expander("Показать промпт"):
                                st.code(out, language=None)
                    if anti:
                        st.markdown("**Типичные ошибки:**")
                        for a in anti:
                            st.warning(a, icon=None)

                # ── Download ───────────────────────────────────────────────────
                if pattern_text:
                    st.download_button(
                        "Скачать шаблон",
                        data=pattern_text,
                        file_name=f"{tech['id']}_template.txt",
                        mime="text/plain",
                        key=f"dl_tech_{tech['id']}",
                        use_container_width=True,
                    )
