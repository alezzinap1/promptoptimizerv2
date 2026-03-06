"""
Prompt Engineer — Main engineering page.
Entrypoint: streamlit run app/main.py
"""
from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

import streamlit as st
from dotenv import load_dotenv

# ── Path setup ────────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

from core.context_builder import ContextBuilder
from core.domain_templates import get_domain_list, get_domain_techniques
from core.parsing import parse_reply, parse_questions
from core.quality_metrics import analyze_prompt
from core.task_classifier import classify_task, get_complexity_label, get_task_types_label
from core.technique_registry import TechniqueRegistry
from db.manager import DBManager
from services.llm_client import (
    DEFAULT_PROVIDER,
    PROVIDER_NAMES,
    TARGET_MODELS,
    LLMClient,
)
from app.shared_styles import THEMES

# ── Resources (cached) ────────────────────────────────────────────────────────
@st.cache_resource
def load_registry() -> TechniqueRegistry:
    return TechniqueRegistry()


@st.cache_resource
def load_llm() -> LLMClient:
    api_key = os.getenv("OPENROUTER_API_KEY", "")
    if not api_key:
        st.error("Не задана переменная окружения **OPENROUTER_API_KEY**. "
                 "Создайте файл `.env` или задайте переменную.")
        st.stop()
    return LLMClient(api_key)


@st.cache_resource
def load_db() -> DBManager:
    db = DBManager()
    db.init()
    return db


@st.cache_data
def _cached_domain_list() -> list[tuple[str, str]]:
    return get_domain_list()


registry = load_registry()
llm      = load_llm()
db       = load_db()

# ── Session state defaults ────────────────────────────────────────────────────
def _init_state() -> None:
    defaults = {
        "session_id":       str(uuid.uuid4()),
        "last_result":      None,
        "iteration_mode":   False,
        "show_save_dialog": False,
        "questions_state":  None,
    }
    for k, v in defaults.items():
        if k not in st.session_state:
            st.session_state[k] = v

_init_state()


# ── Helpers ───────────────────────────────────────────────────────────────────
def _run_generation(
    task_input: str,
    feedback: str,
    gen_model: str,
    target_model: str,
    temperature: float,
    top_p: float | None,
    top_k: int | None,
    technique_mode: str,
    manual_techs: list[str],
    domain: str,
    questions_mode: bool,
) -> None:
    """Core generation logic — classifies, selects techniques, calls LLM."""
    classification  = classify_task(task_input)
    task_types      = classification["task_types"]
    complexity      = classification["complexity"]

    if technique_mode == "manual" and manual_techs:
        techniques = [t for t in (registry.get(tid) for tid in manual_techs) if t]
    elif domain and domain != "auto":
        domain_tech_ids = get_domain_techniques(domain)
        if domain_tech_ids:
            techniques = [t for t in (registry.get(tid) for tid in domain_tech_ids) if t]
        else:
            techniques = registry.select_techniques(
                task_types, complexity, max_techniques=4, target_model=target_model
            )
    else:
        techniques = registry.select_techniques(
            task_types, complexity, max_techniques=4, target_model=target_model
        )

    technique_ids = [t["id"] for t in techniques]

    builder        = ContextBuilder(registry)
    previous_prompt = None

    if st.session_state.iteration_mode and st.session_state.last_result:
        previous_prompt = st.session_state.last_result.get("prompt_block")

    combined_input = task_input
    if feedback.strip():
        combined_input += f"\n\nКомментарий к улучшению: {feedback}"

    system_prompt = builder.build_system_prompt(
        technique_ids=technique_ids,
        target_model=target_model,
        domain=domain or "auto",
        questions_mode=questions_mode,
    )
    user_content = builder.build_user_content(
        combined_input,
        previous_agent_prompt=previous_prompt,
        task_classification=classification,
    )

    # Stream to buffer (clean UX: no raw tags shown to user)
    full_text = ""
    with st.spinner("Генерирую промпт..."):
        for chunk in llm.stream(
            system_prompt, user_content, gen_model, temperature,
            top_p=top_p, top_k=top_k,
        ):
            full_text += chunk

    parsed = parse_reply(full_text)
    metrics = analyze_prompt(parsed.get("prompt_block", "")) if parsed.get("has_prompt") else {}

    st.session_state.last_result = {
        **parsed,
        "techniques":    techniques,
        "technique_ids": technique_ids,
        "task_types":    task_types,
        "complexity":    complexity,
        "task_input":    task_input,
        "gen_model":     gen_model,
        "target_model":  target_model,
        "metrics":       metrics,
    }

    if parsed.get("has_prompt"):
        db.save_prompt_version(
            session_id      = st.session_state.session_id,
            task_input      = task_input,
            task_types      = task_types,
            complexity      = complexity,
            target_model    = target_model,
            gen_model       = gen_model,
            techniques_used = technique_ids,
            reasoning       = parsed.get("reasoning", ""),
            final_prompt    = parsed["prompt_block"],
            metrics         = metrics,
        )

    st.session_state.iteration_mode   = False
    st.session_state.show_save_dialog = False


# ════════════════════════════════════════════════════════════════════════════════
# SIDEBAR
# ════════════════════════════════════════════════════════════════════════════════
with st.sidebar:
    st.caption("Prompt Engineer · Профессиональный инструмент")
    st.divider()
    st.subheader("Генерация")

    gen_model = st.selectbox(
        "Модель для генерации",
        options=list(PROVIDER_NAMES.keys()),
        format_func=lambda x: PROVIDER_NAMES[x],
        index=list(PROVIDER_NAMES.keys()).index(DEFAULT_PROVIDER),
        key="sb_gen_model",
    )

    target_model = st.selectbox(
        "Целевая модель промпта",
        options=list(TARGET_MODELS.keys()),
        format_func=lambda x: TARGET_MODELS[x],
        key="sb_target_model",
        help="Для какой LLM создаётся промпт. Определяет стиль инструкций (XML для Claude, JSON mode для GPT) и набор техник.",
    )

    domain_list = _cached_domain_list()
    domain = st.selectbox(
        "Шаблон домена",
        options=[d[0] for d in domain_list],
        format_func=lambda x: dict(domain_list).get(x, x),
        key="sb_domain",
        help="Контент, редактура, анализ и т.д. — подставляет чеклист и рекомендуемые техники.",
    )

    technique_mode_label = st.radio(
        "Режим техник",
        ["Авто", "Вручную"],
        key="sb_tech_mode",
        help="Авто: подбор по типу задачи и целевой модели. Вручную: полный контроль.",
        horizontal=True,
    )
    technique_mode = "auto" if technique_mode_label == "Авто" else "manual"

    manual_techs: list[str] = []
    if technique_mode == "manual":
        all_techs   = registry.get_all()
        tech_options = {t["id"]: t.get("name", t["id"]) for t in all_techs}
        manual_techs = st.multiselect(
            "Выбери техники (1–6)",
            options=list(tech_options.keys()),
            format_func=lambda x: tech_options[x],
            max_selections=6,
            key="sb_manual_techs",
        )

    with st.expander("Доп. параметры", expanded=False):
        temperature = st.slider(
            "Температура",
            min_value=0.1,
            max_value=1.0,
            value=0.7,
            step=0.1,
            key="sb_temperature",
            help="0.1 = строго/точно, 0.7 = баланс, 1.0 = максимально вариативно",
        )
        top_p = st.slider(
            "Top-P",
            min_value=0.0,
            max_value=1.0,
            value=1.0,
            step=0.05,
            key="sb_top_p",
            help="Ограничивает выбор токенов по кумулятивной вероятности.",
        )
        top_k = st.number_input(
            "Top-K",
            min_value=0,
            max_value=100,
            value=0,
            step=1,
            key="sb_top_k",
            help="0 = выкл. Не все модели поддерживают.",
        )
        questions_mode = st.checkbox(
            "Режим уточняющих вопросов",
            value=True,
            key="sb_questions_mode",
            help="Агент задаёт 2-5 вопросов, если задача недостаточно конкретна.",
        )

    st.divider()

    versions = db.get_session_versions(st.session_state.session_id)
    col_new, col_nav = st.columns(2)
    with col_new:
        if st.button("Новая сессия", use_container_width=True):
            st.session_state.session_id     = str(uuid.uuid4())
            st.session_state.last_result    = None
            st.session_state.iteration_mode = False
            st.rerun()
    with col_nav:
        st.metric("Версий", len(versions))


# ════════════════════════════════════════════════════════════════════════════════
# MAIN CONTENT
# ════════════════════════════════════════════════════════════════════════════════
st.title("Prompt Engineer")

# ── Input section ─────────────────────────────────────────────────────────────
col_in, col_out = st.columns([2, 3], gap="large")

with col_in:
    if st.session_state.iteration_mode:
        st.subheader("Итерация")
        st.info("Опиши что нужно изменить в текущем промпте. Следующий запрос учтёт текущий промпт и твои комментарии.")
    else:
        st.subheader("Задача")

    task_input = st.text_area(
        "Опиши задачу или вставь промпт для улучшения",
        height=180,
        placeholder=(
            "Примеры:\n"
            "• Нужен промпт для анализа финансовых отчётов в JSON формате\n"
            "• Улучши этот промпт: [вставь свой промпт]\n"
            "• Промпт для code review Python кода с фокусом на безопасность"
        ),
        key="main_task_input",
    )

    # Live classification preview
    if task_input and len(task_input.split()) > 3:
        clf         = classify_task(task_input)
        task_label  = get_task_types_label(clf["task_types"])
        comp_label  = get_complexity_label(clf["complexity"])
        tech_preview = registry.select_techniques(
            clf["task_types"], clf["complexity"], max_techniques=3,
            target_model=st.session_state.get("sb_target_model", "unknown"),
        )
        tech_names = ", ".join(t.get("name", t["id"]) for t in tech_preview)
        st.caption(f"**{task_label}** · {comp_label}"
                   + (f" · {tech_names}" if technique_mode == "auto" else ""))

    feedback = ""
    if st.session_state.iteration_mode:
        feedback = st.text_area(
            "Что нужно изменить / добавить",
            height=100,
            placeholder="Напр: Добавить few-shot примеры, сократить на 30%, добавить JSON формат вывода...",
            key="main_feedback",
        )

    btn_label = "Обновить промпт" if st.session_state.iteration_mode else "Создать промпт"
    generate_clicked = st.button(
        btn_label,
        type="primary",
        use_container_width=True,
        disabled=not task_input.strip(),
    )

    if generate_clicked and task_input.strip():
        _run_generation(
            task_input     = task_input.strip(),
            feedback       = feedback,
            gen_model      = st.session_state.get("sb_gen_model", DEFAULT_PROVIDER),
            target_model   = st.session_state.get("sb_target_model", "unknown"),
            temperature    = st.session_state.get("sb_temperature", 0.7),
            top_p          = st.session_state.get("sb_top_p"),
            top_k          = st.session_state.get("sb_top_k") or None,
            technique_mode = technique_mode,
            manual_techs   = manual_techs,
            domain         = st.session_state.get("sb_domain", "auto"),
            questions_mode = st.session_state.get("sb_questions_mode", True),
        )
        st.rerun()


# ── Output section ────────────────────────────────────────────────────────────
with col_out:
    st.subheader("Результат")

    result = st.session_state.last_result

    if result is None:
        st.markdown(
            '<div class="empty-state"><p>Опиши задачу слева и нажми <strong>Создать промпт</strong></p></div>',
            unsafe_allow_html=True,
        )

    elif result.get("has_questions"):
        # ── Q&A flow ──────────────────────────────────────────────────────────
        questions = parse_questions(result.get("questions_raw", ""))
        if questions:
            st.info("Ответь на вопросы — это поможет создать более точный промпт.")
            q_answers: dict[int, str] = {}
            for i, q in enumerate(questions):
                st.write(f"**{i + 1}. {q['question']}**")
                q_answers[i] = st.radio(
                    "",
                    q["options"],
                    key=f"qa_{i}",
                    label_visibility="collapsed",
                )

            col_skip, col_go = st.columns(2)
            with col_skip:
                if st.button("Пропустить все", use_container_width=True):
                    _run_generation(
                        task_input=result["task_input"], feedback="",
                        gen_model=result.get("gen_model", DEFAULT_PROVIDER),
                        target_model=result.get("target_model", "unknown"),
                        temperature=st.session_state.get("sb_temperature", 0.7),
                        top_p=st.session_state.get("sb_top_p"), top_k=st.session_state.get("sb_top_k") or None,
                        technique_mode="manual" if result.get("technique_ids") else "auto",
                        manual_techs=result.get("technique_ids", []),
                        domain=st.session_state.get("sb_domain", "auto"),
                        questions_mode=st.session_state.get("sb_questions_mode", True),
                    )
                    st.rerun()
            with col_go:
                if st.button("Создать промпт с этими ответами", type="primary", use_container_width=True):
                    answers_text = "\n".join(
                        f"{q['question']}: {q_answers.get(i, 'Пропустить')}"
                        for i, q in enumerate(questions)
                    )
                    combined = (
                        f"Исходный запрос: {result['task_input']}\n\n"
                        f"Ответы на уточняющие вопросы:\n{answers_text}\n\n"
                        "Создай промпт в блоке [PROMPT]...[/PROMPT]."
                    )
                    _run_generation(
                        task_input=combined, feedback="",
                        gen_model=result.get("gen_model", DEFAULT_PROVIDER),
                        target_model=result.get("target_model", "unknown"),
                        temperature=st.session_state.get("sb_temperature", 0.7),
                        top_p=st.session_state.get("sb_top_p"), top_k=st.session_state.get("sb_top_k") or None,
                        technique_mode="manual" if result.get("technique_ids") else "auto",
                        manual_techs=result.get("technique_ids", []),
                        domain=st.session_state.get("sb_domain", "auto"),
                        questions_mode=st.session_state.get("sb_questions_mode", True),
                    )
                    st.rerun()

    elif result.get("has_prompt"):
        # ── Prompt result ──────────────────────────────────────────────────────
        techniques = result.get("techniques", [])
        task_label = get_task_types_label(result.get("task_types", []))
        comp_label = get_complexity_label(result.get("complexity", "medium"))
        target     = TARGET_MODELS.get(result.get("target_model", "unknown"), "?")
        tech_badges = " ".join(f"`{t.get('name', t['id'])}`" for t in techniques[:4])

        st.caption(f"**{task_label}** · {comp_label} · {target}  {tech_badges}")

        # Reasoning expander
        if result.get("reasoning"):
            with st.expander("Почему именно эти техники?"):
                st.markdown(result["reasoning"])

        # Editable prompt textarea
        edited_prompt = st.text_area(
            "Промпт (можно редактировать)",
            value=result["prompt_block"],
            height=300,
            key="output_prompt",
        )

        # ── Metrics ───────────────────────────────────────────────────────────
        m = result.get("metrics") or analyze_prompt(edited_prompt)
        score = m.get("completeness_score", m.get("quality_score", 0))

        st.markdown("**Метрики промпта**")
        mr1, mr2 = st.columns(2)
        with mr1:
            mc1, mc2, mc3 = st.columns(3)
            mc1.metric("Токены", m.get("token_estimate", 0), help="Оценка ~4 символа/токен.")
            mc2.metric("Инструкции", m.get("instruction_count", 0))
            mc3.metric("Ограничения", m.get("constraint_count", 0))
        with mr2:
            mc4, mc5 = st.columns(2)
            mc4.metric("Роль", "Да" if m.get("has_role") else "Нет")
            mc5.metric(
                "Completeness",
                f"{score:.0f}%",
                delta=m.get("completeness_label", m.get("quality_label", "")),
                help="Проверка наличия типовых элементов: роль, формат, инструкции, ограничения.",
            )

        # Improvement tips
        tips = m.get("improvement_tips", [])
        if tips:
            with st.expander(f"Советы по улучшению ({len(tips)})"):
                for tip in tips:
                    st.markdown(f"- {tip}")

        st.divider()

        # ── Action buttons ────────────────────────────────────────────────────
        ac1, ac2, ac3, ac4 = st.columns(4)

        with ac1:
            st.download_button(
                "Скачать .txt",
                data=edited_prompt,
                file_name="prompt.txt",
                mime="text/plain",
                use_container_width=True,
            )

        with ac2:
            if st.button("Итерировать", use_container_width=True, help="Режим правок: следующий запрос учтёт текущий промпт и твои комментарии"):
                st.session_state.last_result["prompt_block"] = edited_prompt
                st.session_state.iteration_mode = True
                st.rerun()

        with ac3:
            if st.button("Сравнить", use_container_width=True, help="Открыть страницу A/B: одна задача, два набора техник, сравнение метрик"):
                st.session_state["compare_prompt"] = edited_prompt
                st.switch_page("pages/2_Compare.py")

        with ac4:
            if st.button("В библиотеку", use_container_width=True, type="secondary"):
                st.session_state.show_save_dialog = not st.session_state.show_save_dialog
                st.rerun()

        # ── Save dialog ───────────────────────────────────────────────────────
        if st.session_state.show_save_dialog:
            with st.form("save_to_library"):
                st.markdown("**Сохранить в библиотеку**")
                save_title = st.text_input(
                    "Название",
                    value=result.get("task_input", "")[:60],
                )
                save_tags = st.text_input(
                    "Теги (через запятую)",
                    placeholder="анализ, финансы, json",
                )
                save_notes = st.text_area("Заметки", height=60)

                s1, s2 = st.columns(2)
                if s1.form_submit_button("Сохранить", use_container_width=True):
                    tags = [t.strip() for t in save_tags.split(",") if t.strip()]
                    technique_ids = result.get("technique_ids", [])
                    task_types    = result.get("task_types", ["general"])
                    db.save_to_library(
                        title        = save_title or "Без названия",
                        prompt       = edited_prompt,
                        tags         = tags,
                        target_model = result.get("target_model", "unknown"),
                        task_type    = task_types[0] if task_types else "general",
                        techniques   = technique_ids,
                        notes        = save_notes,
                    )
                    st.session_state.show_save_dialog = False
                    st.success("Сохранено!")
                    st.rerun()
                if s2.form_submit_button("Отмена", use_container_width=True):
                    st.session_state.show_save_dialog = False
                    st.rerun()

        # ── Version history ───────────────────────────────────────────────────
        if len(versions) > 1:
            with st.expander(f"История версий ({len(versions)})"):
                for v in reversed(versions):
                    ver_label = f"v{v['version']}"
                    tech_str  = ", ".join(v.get("techniques_used") or [])
                    m_v       = v.get("metrics") or {}
                    col_v, col_copy = st.columns([4, 1])
                    with col_v:
                        st.markdown(
                            f"**{ver_label}** — {v['created_at'][:16]}  "
                            f"· `{tech_str}` · {m_v.get('completeness_score', m_v.get('quality_score', 0)):.0f}%"
                        )
                        with st.expander(f"Показать {ver_label}"):
                            st.code(v.get("final_prompt", ""), language=None)
                    with col_copy:
                        if st.button(
                            "Загрузить",
                            key=f"load_v{v['version']}",
                            use_container_width=True,
                        ):
                            st.session_state.last_result["prompt_block"] = v["final_prompt"]
                            st.rerun()

    else:
        # Raw text response (no [PROMPT] block)
        st.markdown(result.get("text", ""))
        if st.button("Попробовать снова"):
            st.session_state.last_result = None
            st.rerun()
