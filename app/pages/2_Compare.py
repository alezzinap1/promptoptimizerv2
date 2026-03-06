"""
A/B Compare page — run the same task with two different technique sets
and compare the results side by side.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import streamlit as st
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

from core.context_builder import ContextBuilder
from core.parsing import parse_reply
from core.quality_metrics import analyze_prompt
from core.task_classifier import classify_task, get_task_types_label, get_complexity_label
from core.technique_registry import TechniqueRegistry
from services.llm_client import PROVIDER_NAMES, TARGET_MODELS, LLMClient, DEFAULT_PROVIDER


@st.cache_resource
def load_registry() -> TechniqueRegistry:
    return TechniqueRegistry()


@st.cache_resource
def load_llm() -> LLMClient:
    api_key = os.getenv("OPENROUTER_API_KEY", "")
    if not api_key:
        st.error("OPENROUTER_API_KEY not set")
        st.stop()
    return LLMClient(api_key)


registry = load_registry()
llm      = load_llm()

all_techs    = registry.get_all()
tech_options = {t["id"]: t.get("name", t["id"]) for t in all_techs}

st.title("A/B Сравнение техник")
st.caption("Сгенерируй один промпт двумя разными наборами техник и сравни результат")

# ── Settings bar ──────────────────────────────────────────────────────────────
with st.expander("Настройки генерации", expanded=False):
    sc1, sc2, sc3, sc4 = st.columns(4)
    gen_model    = sc1.selectbox(
        "Модель генерации",
        options=list(PROVIDER_NAMES.keys()),
        format_func=lambda x: PROVIDER_NAMES[x],
        index=list(PROVIDER_NAMES.keys()).index(DEFAULT_PROVIDER),
    )
    target_model = sc2.selectbox(
        "Целевая модель промпта",
        options=list(TARGET_MODELS.keys()),
        format_func=lambda x: TARGET_MODELS[x],
    )
    temperature  = sc3.slider("Температура", 0.1, 1.0, 0.7, 0.1)
    top_p        = sc4.slider("Top-P", 0.0, 1.0, 1.0, 0.05)

# ── Task input ────────────────────────────────────────────────────────────────
pre_filled = st.session_state.pop("compare_prompt", "")
task_input = st.text_area(
    "Задача (одна для обоих вариантов)",
    value=pre_filled,
    height=120,
    placeholder="Нужен промпт для извлечения ключевых метрик из финансового отчёта...",
)

# ── Technique selector ────────────────────────────────────────────────────────
st.markdown("**Наборы техник для сравнения**")
tc1, tc2 = st.columns(2)

TECH_MODE_MANUAL = "manual"
TECH_MODE_AUTO = "auto"
TECH_MODE_OPTIONS = [(TECH_MODE_AUTO, "Авто"), (TECH_MODE_MANUAL, "Вручную")]

with tc1:
    st.markdown("**Вариант A**")
    techs_a_mode = st.radio(
        "Режим выбора техник",
        options=[o[0] for o in TECH_MODE_OPTIONS],
        format_func=lambda x: dict(TECH_MODE_OPTIONS)[x],
        key="ta_mode",
        horizontal=True,
    )
    techs_a: list[str] = []
    if techs_a_mode == TECH_MODE_MANUAL:
        techs_a = st.multiselect(
            "Техники A",
            options=list(tech_options.keys()),
            format_func=lambda x: tech_options[x],
            max_selections=4,
            key="ta_manual",
        )

with tc2:
    st.markdown("**Вариант B**")
    techs_b_mode = st.radio(
        "Режим выбора техник",
        options=[o[0] for o in TECH_MODE_OPTIONS],
        format_func=lambda x: dict(TECH_MODE_OPTIONS)[x],
        key="tb_mode",
        horizontal=True,
    )
    techs_b: list[str] = []
    if techs_b_mode == TECH_MODE_MANUAL:
        techs_b = st.multiselect(
            "Техники B",
            options=list(tech_options.keys()),
            format_func=lambda x: tech_options[x],
            max_selections=4,
            key="tb_manual",
        )

compare_clicked = st.button(
    "Сгенерировать оба варианта",
    type="primary",
    disabled=not task_input.strip(),
    use_container_width=True,
)

if compare_clicked and task_input.strip():
    classification = classify_task(task_input)
    task_types     = classification["task_types"]
    complexity     = classification["complexity"]

    builder = ContextBuilder(registry)

    # Resolve techniques for A and B
    def resolve_techs(mode: str, manual: list[str]) -> list[dict]:
        if mode == TECH_MODE_MANUAL and manual:
            return [t for t in (registry.get(tid) for tid in manual) if t]
        return registry.select_techniques(task_types, complexity, 3, target_model)

    techniques_a = resolve_techs(techs_a_mode, techs_a)
    techniques_b = resolve_techs(techs_b_mode, techs_b)

    ids_a = [t["id"] for t in techniques_a]
    ids_b = [t["id"] for t in techniques_b]

    user_content = builder.build_user_content(task_input, task_classification=classification)

    col_a, col_b = st.columns(2)

    # Generate A
    result_a_text = ""
    with col_a:
        with st.spinner("Генерирую вариант A..."):
            system_a = builder.build_system_prompt(
                technique_ids=ids_a, target_model=target_model
            )
            for chunk in llm.stream(system_a, user_content, gen_model, temperature, top_p=top_p):
                result_a_text += chunk

    # Generate B
    result_b_text = ""
    with col_b:
        with st.spinner("Генерирую вариант B..."):
            system_b = builder.build_system_prompt(
                technique_ids=ids_b, target_model=target_model
            )
            for chunk in llm.stream(system_b, user_content, gen_model, temperature, top_p=top_p):
                result_b_text += chunk

    parsed_a = parse_reply(result_a_text)
    parsed_b = parse_reply(result_b_text)

    prompt_a = parsed_a.get("prompt_block") or result_a_text
    prompt_b = parsed_b.get("prompt_block") or result_b_text

    metrics_a = analyze_prompt(prompt_a)
    metrics_b = analyze_prompt(prompt_b)

    st.divider()
    st.subheader("Результаты сравнения")

    # Metric comparison table
    labels = ["Токены", "Инструкции", "Ограничения", "Completeness %"]
    score_a = metrics_a.get("completeness_score", metrics_a.get("quality_score", 0))
    score_b = metrics_b.get("completeness_score", metrics_b.get("quality_score", 0))
    vals_a = [
        metrics_a["token_estimate"],
        metrics_a["instruction_count"],
        metrics_a["constraint_count"],
        f"{score_a:.0f}%",
    ]
    vals_b = [
        metrics_b["token_estimate"],
        metrics_b["instruction_count"],
        metrics_b["constraint_count"],
        f"{score_b:.0f}%",
    ]

    mc0, mc1, mc2, mc3, mc4 = st.columns([2, 1, 1, 1, 1])
    mc0.markdown("**Метрика**")
    mc1.markdown("**Вариант A**")
    mc2.markdown("**Вариант B**")
    mc3.markdown("**Разница**")

    for label, va, vb in zip(labels, vals_a, vals_b):
        row = st.columns([2, 1, 1, 1])
        row[0].write(label)
        row[1].write(str(va))
        row[2].write(str(vb))
        if isinstance(va, int) and isinstance(vb, int):
            diff = vb - va
            row[3].write(f"{'+' if diff >= 0 else ''}{diff}")

    st.divider()

    # Side by side prompts
    col_pa, col_pb = st.columns(2)

    with col_pa:
        names_a = " + ".join(t.get("name", t["id"]) for t in techniques_a)
        st.markdown(f"**Вариант A** · `{names_a}`")
        if parsed_a.get("reasoning"):
            with st.expander("Reasoning A"):
                st.markdown(parsed_a["reasoning"])
        edited_a = st.text_area(
            "Промпт A", value=prompt_a, height=350, key="cmp_prompt_a"
        )
        st.download_button(
            "Скачать A",
            data=edited_a,
            file_name="prompt_a.txt",
            mime="text/plain",
        )

    with col_pb:
        names_b = " + ".join(t.get("name", t["id"]) for t in techniques_b)
        st.markdown(f"**Вариант B** · `{names_b}`")
        if parsed_b.get("reasoning"):
            with st.expander("Reasoning B"):
                st.markdown(parsed_b["reasoning"])
        edited_b = st.text_area(
            "Промпт B", value=prompt_b, height=350, key="cmp_prompt_b"
        )
        st.download_button(
            "Скачать B",
            data=edited_b,
            file_name="prompt_b.txt",
            mime="text/plain",
        )

    # Winner suggestion
    if score_a != score_b:
        winner    = "A" if score_a >= score_b else "B"
        win_score = max(score_a, score_b)
        st.success(f"По метрикам лидирует **Вариант {winner}** ({win_score:.0f}%)")
    else:
        st.info("Варианты одинаковы по метрикам — выбирай по содержанию")
