"""
Prompt Engineer — Main engineering page.
Entrypoint: streamlit run app/main.py
"""
from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path
from time import perf_counter

import streamlit as st
from dotenv import load_dotenv

# ── Path setup ────────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")

from core.context_builder import ContextBuilder
from core.domain_templates import get_domain_list, get_domain_techniques
from core.evidence import build_evidence_map
from core.intent_graph import build_intent_graph
from core.parsing import parse_reply, parse_questions
from core.prompt_debugger import analyze_prompt_spec
import inspect
from core.prompt_spec import build_generation_brief, build_prompt_spec

_BUILD_PROMPT_SPEC_ACCEPTS_OVERRIDES = "overrides" in inspect.signature(build_prompt_spec).parameters
from core.quality_metrics import analyze_prompt
from core.task_classifier import classify_task, get_complexity_label, get_task_types_label
from core.technique_registry import TechniqueRegistry
from core.workspace_profile import normalize_workspace
from db.manager import DBManager
from services.llm_client import (
    DEFAULT_PROVIDER,
    PROVIDER_NAMES,
    TARGET_MODELS,
    LLMClient,
)
from app.abuse import check_input_size, check_rate_limit, check_session_budget
from app.auth import get_current_user_id, require_auth
from app.config import DB_PATH
from app.shared_styles import inject_styles

# ── Resources (cached) ────────────────────────────────────────────────────────
@st.cache_resource
def load_registry() -> TechniqueRegistry:
    return TechniqueRegistry()


@st.cache_resource
def load_llm() -> LLMClient:
    from app.config import LLM_TIMEOUT_SEC

    api_key = os.getenv("OPENROUTER_API_KEY", "")
    if not api_key:
        st.error("Не задана переменная окружения **OPENROUTER_API_KEY**. "
                 "Создайте файл `.env` или задайте переменную.")
        st.stop()
    if "timeout" in inspect.signature(LLMClient).parameters:
        return LLMClient(api_key, timeout=float(LLM_TIMEOUT_SEC))
    return LLMClient(api_key)


@st.cache_resource
def load_db() -> DBManager:
    db = DBManager(db_path=DB_PATH)
    db.init()
    return db


@st.cache_data
def _cached_domain_list() -> list[tuple[str, str]]:
    return get_domain_list()


registry = load_registry()
llm      = load_llm()
db       = load_db()
current_user = require_auth(db)

# ── Session state defaults ────────────────────────────────────────────────────
def _init_state() -> None:
    defaults = {
        "session_id":       str(uuid.uuid4()),
        "last_result":      None,
        "iteration_mode":   False,
        "show_save_dialog": False,
        "questions_state":  None,
        "sb_gen_model":     DEFAULT_PROVIDER,
        "sb_target_model":  "unknown",
        "sb_domain":        "auto",
        "sb_tech_mode":     "Авто",
        "sb_temperature":   0.7,
        "sb_top_p":         1.0,
        "sb_top_k":         0,
        "sb_questions_mode": True,
        "sb_manual_techs":  [],
        "sb_workspace_id":  0,
        "ide_evidence_decisions": {},
        "generation_count": 0,
    }
    for k, v in defaults.items():
        if k not in st.session_state:
            st.session_state[k] = v

_init_state()


# ── Helpers ───────────────────────────────────────────────────────────────────
def _log_event(event_name: str, payload: dict | None = None) -> None:
    user_id = get_current_user_id()
    db.log_event(
        event_name=event_name,
        session_id=st.session_state.get("session_id"),
        payload=payload or {},
        user_id=user_id,
    )


def _parse_lines(text: str) -> list[str]:
    """Parse textarea content into a compact list representation."""
    return [line.strip() for line in text.splitlines() if line.strip()]


def _get_active_workspace() -> dict | None:
    """Return the currently selected workspace, if any."""
    workspace_id = int(st.session_state.get("sb_workspace_id") or 0)
    user_id = get_current_user_id()
    return db.get_workspace(workspace_id, user_id=user_id) if workspace_id else None


def _build_prompt_spec_with_overrides(
    raw_input: str,
    classification: dict,
    target_model: str,
    workspace: dict | None,
    previous_prompt: str | None,
    overrides: dict | None,
) -> dict:
    """Build prompt spec, applying overrides. Handles older prompt_spec without overrides param."""
    if _BUILD_PROMPT_SPEC_ACCEPTS_OVERRIDES:
        return build_prompt_spec(
            raw_input=raw_input,
            classification=classification,
            target_model=target_model,
            workspace=workspace,
            previous_prompt=previous_prompt,
            overrides=overrides,
        )
    spec = build_prompt_spec(
        raw_input=raw_input,
        classification=classification,
        target_model=target_model,
        workspace=workspace,
        previous_prompt=previous_prompt,
    )
    if overrides:
        if overrides.get("audience"):
            spec["audience"] = str(overrides["audience"]).strip() or None
        if overrides.get("output_format"):
            spec["output_format"] = overrides["output_format"]
        for key in ("constraints", "source_of_truth", "success_criteria"):
            val = overrides.get(key)
            if val is not None:
                spec[key] = _parse_lines(str(val)) if isinstance(val, str) else [str(x).strip() for x in val if str(x).strip()]
    return spec


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
    prompt_spec_overrides: dict | None = None,
) -> None:
    """Core generation logic — classifies, selects techniques, calls LLM."""
    classification  = classify_task(task_input)
    task_types      = classification["task_types"]
    complexity      = classification["complexity"]
    workspace       = _get_active_workspace()

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

    prompt_spec = _build_prompt_spec_with_overrides(
        raw_input=task_input,
        classification=classification,
        target_model=target_model,
        workspace=workspace,
        previous_prompt=previous_prompt,
        overrides=prompt_spec_overrides,
    )
    evidence = build_evidence_map(prompt_spec, task_input, workspace)
    debug_issues = analyze_prompt_spec(prompt_spec)
    db.save_prompt_spec(
        session_id=st.session_state.session_id,
        raw_input=task_input,
        workspace_id=workspace.get("id") if workspace else None,
        spec=prompt_spec,
        evidence=evidence,
        issues=debug_issues,
        user_id=get_current_user_id(),
    )

    combined_input = build_generation_brief(prompt_spec)
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
    started_at = perf_counter()
    try:
        with st.spinner("Генерирую промпт..."):
            for chunk in llm.stream(
                system_prompt, user_content, gen_model, temperature,
                top_p=top_p, top_k=top_k,
            ):
                full_text += chunk
    except Exception as e:
        err_msg = str(e).lower()
        if "not a valid model id" in err_msg or "invalid model" in err_msg:
            _log_event("generation_error", {"error": "invalid_model", "gen_model": gen_model})
            st.session_state["model_error"] = (
                "**ID модели устарел.** Выбранная модель больше не поддерживается API. "
                "Выбери другую модель в выпадающем меню слева (например, DeepSeek или Gemini)."
            )
            return
        _log_event("generation_error", {"error": str(e), "gen_model": gen_model})
        raise

    parsed = parse_reply(full_text)
    metrics = analyze_prompt(parsed.get("prompt_block", "")) if parsed.get("has_prompt") else {}
    latency_ms = round((perf_counter() - started_at) * 1000, 1)
    outcome = "prompt" if parsed.get("has_prompt") else "questions" if parsed.get("has_questions") else "raw_text"

    _log_event(
        "generation_result",
        {
            "outcome": outcome,
            "gen_model": gen_model,
            "target_model": target_model,
            "latency_ms": latency_ms,
            "technique_ids": technique_ids,
            "completeness_score": metrics.get("completeness_score", 0.0),
        },
    )

    st.session_state.pop("model_error", None)  # Очищаем ошибку при успешной генерации
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
        "prompt_spec":   prompt_spec,
        "evidence":      evidence,
        "debug_issues":  debug_issues,
        "workspace":     normalize_workspace(workspace),
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
            user_id         = get_current_user_id(),
        )
        _log_event(
            "generate_prompt_success",
            {
                "target_model": target_model,
                "gen_model": gen_model,
                "completeness_score": metrics.get("completeness_score", 0.0),
                "workspace_id": workspace.get("id") if workspace else None,
                "debug_issue_count": len(debug_issues),
            },
        )
    elif parsed.get("has_questions"):
        parsed_questions = parse_questions(parsed.get("questions_raw", "")) or []
        _log_event(
            "generate_questions",
            {
                "target_model": target_model,
                "gen_model": gen_model,
                "question_count": len(parsed_questions),
            },
        )
    else:
        _log_event("generate_raw_text", {"target_model": target_model, "gen_model": gen_model})

    st.session_state.iteration_mode   = False
    st.session_state.show_save_dialog = False
    st.session_state["generation_count"] = st.session_state.get("generation_count", 0) + 1


# ════════════════════════════════════════════════════════════════════════════════
# MAIN CONTENT
# ════════════════════════════════════════════════════════════════════════════════
inject_styles()

versions = db.get_session_versions(st.session_state.session_id, user_id=get_current_user_id())
active_workspace = _get_active_workspace()

# ── Title + settings gear ─────────────────────────────────────────────────────
col_title, col_gear = st.columns([10, 1])
with col_title:
    st.title("Prompt Engineer")
    if active_workspace:
        st.caption(f"Workspace: **{active_workspace['name']}**")
with col_gear:
    with st.popover("⚙️", help="Настройки генерации"):
        st.caption("Параметры генерации")
        workspaces = db.list_workspaces(user_id=get_current_user_id())
        workspace_options = [0] + [ws["id"] for ws in workspaces]
        workspace_labels = {0: "Без workspace"} | {ws["id"]: ws["name"] for ws in workspaces}
        if st.session_state.get("sb_workspace_id") not in workspace_options:
            st.session_state["sb_workspace_id"] = 0
        st.selectbox(
            "Workspace",
            options=workspace_options,
            format_func=lambda x: workspace_labels[x],
            key="sb_workspace_id",
            help="Workspace добавляет reusable контекст, ограничения и reference snippets.",
        )
        st.selectbox(
            "Модель для генерации",
            options=list(PROVIDER_NAMES.keys()),
            format_func=lambda x: PROVIDER_NAMES[x],
            key="sb_gen_model",
        )
        st.selectbox(
            "Целевая модель промпта",
            options=list(TARGET_MODELS.keys()),
            format_func=lambda x: TARGET_MODELS[x],
            key="sb_target_model",
            help="Для какой LLM создаётся промпт.",
        )
        domain_list = _cached_domain_list()
        st.selectbox(
            "Шаблон домена",
            options=[d[0] for d in domain_list],
            format_func=lambda x: dict(domain_list).get(x, x),
            key="sb_domain",
            help="Контент, редактура, анализ и т.д.",
        )
        st.radio(
            "Режим техник",
            ["Авто", "Вручную"],
            key="sb_tech_mode",
            horizontal=True,
        )
        if st.session_state.get("sb_tech_mode") == "Вручную":
            all_techs = registry.get_all()
            tech_options = {t["id"]: t.get("name", t["id"]) for t in all_techs}
            st.multiselect(
                "Выбери техники (1–6)",
                options=list(tech_options.keys()),
                format_func=lambda x: tech_options[x],
                max_selections=6,
                key="sb_manual_techs",
            )
        with st.expander("Доп. параметры", expanded=False):
            st.slider("Температура", 0.1, 1.0, 0.7, 0.1, key="sb_temperature")
            st.slider("Top-P", 0.0, 1.0, 1.0, 0.05, key="sb_top_p")
            st.number_input("Top-K", 0, 100, 0, 1, key="sb_top_k")
            st.checkbox("Режим уточняющих вопросов", True, key="sb_questions_mode")
        st.divider()
        col_new, col_ver = st.columns(2)
        with col_new:
            if st.button("Новая сессия", use_container_width=True, key="popover_new_session"):
                st.session_state.session_id = str(uuid.uuid4())
                st.session_state.last_result = None
                st.session_state.iteration_mode = False
                st.rerun()
        with col_ver:
            st.metric("Версий", len(versions))

technique_mode = "auto" if st.session_state.get("sb_tech_mode", "Авто") == "Авто" else "manual"
manual_techs = st.session_state.get("sb_manual_techs", [])

# ── Input section ─────────────────────────────────────────────────────────────
col_in, col_out = st.columns([2, 3], gap="large")

with col_in:
    if st.session_state.iteration_mode:
        st.subheader("Итерация")
        st.info("Опиши что нужно изменить в текущем промпте. Следующий запрос учтёт текущий промпт и твои комментарии.")
    else:
        st.subheader("Задача")

    prefill_task = st.session_state.pop("prefill_task", "")
    if prefill_task:
        st.session_state["main_task_input"] = prefill_task
        st.session_state["main_feedback"] = ""
        st.session_state["iteration_mode"] = False
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
        active_workspace = _get_active_workspace()
        clf         = classify_task(task_input)
        task_label  = get_task_types_label(clf["task_types"])
        comp_label  = get_complexity_label(clf["complexity"])
        tech_preview = registry.select_techniques(
            clf["task_types"], clf["complexity"], max_techniques=3,
            target_model=st.session_state.get("sb_target_model", "unknown"),
        )
        preview_spec = build_prompt_spec(
            raw_input=task_input,
            classification=clf,
            target_model=st.session_state.get("sb_target_model", "unknown"),
            workspace=active_workspace,
        )
        seed_key = f"{task_input}|{st.session_state.get('sb_workspace_id', 0)}|{st.session_state.get('sb_target_model', 'unknown')}"
        if st.session_state.get("ide_seed_key") != seed_key:
            st.session_state["ide_seed_key"] = seed_key
            st.session_state["ide_audience"] = preview_spec.get("audience") or ""
            st.session_state["ide_evidence_decisions"] = {}
            st.session_state["ide_output_format"] = preview_spec.get("output_format") or ""
            st.session_state["ide_constraints"] = "\n".join(preview_spec.get("constraints") or [])
            st.session_state["ide_source_of_truth"] = "\n".join(preview_spec.get("source_of_truth") or [])
            st.session_state["ide_success_criteria"] = "\n".join(preview_spec.get("success_criteria") or [])

        preview_overrides = {
            "audience": st.session_state.get("ide_audience", ""),
            "output_format": st.session_state.get("ide_output_format", ""),
            "constraints": _parse_lines(st.session_state.get("ide_constraints", "")),
            "source_of_truth": _parse_lines(st.session_state.get("ide_source_of_truth", "")),
            "success_criteria": _parse_lines(st.session_state.get("ide_success_criteria", "")),
        }
        preview_spec = _build_prompt_spec_with_overrides(
            raw_input=task_input,
            classification=clf,
            target_model=st.session_state.get("sb_target_model", "unknown"),
            workspace=active_workspace,
            previous_prompt=None,
            overrides=preview_overrides,
        )
        preview_evidence = build_evidence_map(preview_spec, task_input, active_workspace)
        preview_issues = analyze_prompt_spec(preview_spec)
        preview_graph = build_intent_graph(preview_spec)
        tech_names = ", ".join(t.get("name", t["id"]) for t in tech_preview)
        st.caption(f"**{task_label}** · {comp_label}"
                   + (f" · {tech_names}" if technique_mode == "auto" else ""))
        with st.expander("IDE-анализ запроса", expanded=False):
            tab_editor, tab_intent, tab_debug, tab_evidence = st.tabs(["Spec Editor", "Intent", "Debugger", "Evidence"])
            with tab_editor:
                st.caption("Это уже не просто preview: ты можешь вручную доопределить PromptSpec перед генерацией.")
                st.text_input(
                    "Аудитория",
                    key="ide_audience",
                    placeholder="Напр. junior developers / финансовый аналитик / маркетолог",
                )
                st.selectbox(
                    "Формат вывода",
                    options=["", "json", "xml", "yaml", "markdown", "table", "list"],
                    key="ide_output_format",
                    format_func=lambda x: x or "Автоопределение",
                )
                st.text_area(
                    "Источник истины",
                    key="ide_source_of_truth",
                    height=80,
                    placeholder="По одному источнику на строку: user_provided_report, user_provided_code, workspace_reference_snippets ...",
                )
                st.text_area(
                    "Критерии успеха",
                    key="ide_success_criteria",
                    height=80,
                    placeholder="Напр. Ответ должен быть в JSON\nНе додумывать факты",
                )
                st.text_area(
                    "Ограничения",
                    key="ide_constraints",
                    height=100,
                    placeholder="По одному ограничению на строку",
                )
            with tab_intent:
                for node in preview_graph:
                    status = "OK" if node["status"] == "known" else "Missing"
                    st.markdown(f"- **{node['label']}**: {status} · `{node['criticality']}`")
                    if node["value"]:
                        st.caption(node["value"])
            with tab_debug:
                if not preview_issues:
                    st.success("Критичных структурных проблем не найдено.")
                else:
                    for issue in preview_issues:
                        st.markdown(f"**[{issue['severity'].upper()}] {issue['message']}**")
                        st.caption(issue["why_it_matters"])
                        st.markdown(f"- Что сделать: {issue['suggested_fix']}")
            with tab_evidence:
                st.caption("Происхождение полей. Для inferred/workspace можно принять или отклонить.")
                decisions = st.session_state.get("ide_evidence_decisions") or {}
                for field, meta in preview_evidence.items():
                    dec = decisions.get(field)
                    status = f" · [{dec}]" if dec else ""
                    st.markdown(f"- **{field}**: `{meta['source_type']}` ({meta['confidence']:.2f}){status}")
                    if meta.get("value_preview"):
                        st.caption(f"Значение: {meta['value_preview']}")
                    st.caption(meta["reason"])
                    if meta.get("can_accept_reject"):
                        c1, c2, _ = st.columns([1, 1, 4])
                        with c1:
                            if st.button("✓ Принять", key=f"ev_accept_{field}", help="Подтвердить значение"):
                                st.session_state.setdefault("ide_evidence_decisions", {})[field] = "accept"
                                st.rerun()
                        with c2:
                            if st.button("✗ Отклонить", key=f"ev_reject_{field}", help="Исключить из spec"):
                                st.session_state.setdefault("ide_evidence_decisions", {})[field] = "reject"
                                st.rerun()

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
        ok, err = check_input_size(task_input)
        if not ok:
            st.error(err)
            st.stop()
        ok, err = check_rate_limit(st.session_state.get("session_id", ""))
        if not ok:
            st.error(err)
            st.stop()
        gen_count = st.session_state.get("generation_count", 0)
        ok, err = check_session_budget(gen_count)
        if not ok:
            st.error(err)
            st.stop()
        _log_event(
            "generate_requested",
            {
                "iteration_mode": st.session_state.iteration_mode,
                "questions_mode": st.session_state.get("sb_questions_mode", True),
                "technique_mode": technique_mode,
                "workspace_id": st.session_state.get("sb_workspace_id", 0),
            },
        )
        decisions = st.session_state.get("ide_evidence_decisions") or {}
        spec_overrides = {
            "audience": st.session_state.get("ide_audience", ""),
            "output_format": st.session_state.get("ide_output_format", ""),
            "constraints": _parse_lines(st.session_state.get("ide_constraints", "")),
            "source_of_truth": _parse_lines(st.session_state.get("ide_source_of_truth", "")),
            "success_criteria": _parse_lines(st.session_state.get("ide_success_criteria", "")),
        }
        for field, decision in decisions.items():
            if decision == "reject" and field in spec_overrides:
                spec_overrides[field] = [] if field in ("constraints", "source_of_truth", "success_criteria") else ""
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
            prompt_spec_overrides=spec_overrides,
        )
        st.rerun()


# ── Output section ────────────────────────────────────────────────────────────
with col_out:
    st.subheader("Результат")

    if st.session_state.get("model_error"):
        st.error(st.session_state["model_error"])

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
            st.info("Ответь на вопросы — можно выбрать несколько вариантов или ввести свой.")
            q_answers: dict[int, list[str]] = {}
            q_custom: dict[int, str] = {}
            for i, q in enumerate(questions):
                st.write(f"**{i + 1}. {q['question']}**")
                q_answers[i] = st.multiselect(
                    "Варианты",
                    q["options"],
                    default=[],
                    key=f"qa_{i}",
                    label_visibility="collapsed",
                )
                q_custom[i] = st.text_input(
                    "Свой вариант",
                    placeholder="Или введите свой ответ...",
                    key=f"qa_custom_{i}",
                    label_visibility="collapsed",
                )

            col_skip, col_go = st.columns(2)
            with col_skip:
                if st.button("Пропустить все", use_container_width=True):
                    _log_event("questions_skipped", {"question_count": len(questions)})
                    _run_generation(
                        task_input=result["task_input"], feedback="",
                        gen_model=result.get("gen_model", DEFAULT_PROVIDER),
                        target_model=result.get("target_model", "unknown"),
                        temperature=st.session_state.get("sb_temperature", 0.7),
                        top_p=st.session_state.get("sb_top_p"), top_k=st.session_state.get("sb_top_k") or None,
                        technique_mode="manual" if result.get("technique_ids") else "auto",
                        manual_techs=result.get("technique_ids", []),
                        domain=st.session_state.get("sb_domain", "auto"),
                        questions_mode=False,
                    )
                    st.rerun()
            with col_go:
                if st.button("Создать промпт с этими ответами", type="primary", use_container_width=True):
                    def _format_answer(i: int, q: dict) -> str:
                        selected = q_answers.get(i, [])
                        custom = (q_custom.get(i) or "").strip()
                        parts = selected + ([custom] if custom else [])
                        return ", ".join(parts) if parts else "Пропустить"

                    answers_text = "\n".join(
                        f"{q['question']}: {_format_answer(i, q)}"
                        for i, q in enumerate(questions)
                    )
                    combined = (
                        f"Исходный запрос: {result['task_input']}\n\n"
                        f"Ответы на уточняющие вопросы:\n{answers_text}\n\n"
                        "Создай промпт в блоке [PROMPT]...[/PROMPT]."
                    )
                    _log_event(
                        "questions_answered",
                        {
                            "question_count": len(questions),
                            "answered_count": sum(1 for i, q in enumerate(questions) if _format_answer(i, q) != "Пропустить"),
                        },
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
                        questions_mode=False,
                    )
                    st.rerun()
        else:
            st.warning("Модель вернула блок вопросов в неожиданном формате. Попробуй сгенерировать снова или отключить режим уточнений.")
            st.code(result.get("questions_raw", ""), language=None)

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

        spec = result.get("prompt_spec") or {}
        evidence = result.get("evidence") or {}
        debug_issues = result.get("debug_issues") or []
        workspace = result.get("workspace") or {}
        if spec:
            with st.expander("Prompt IDE: spec / debugger / evidence", expanded=False):
                tab_spec, tab_debug, tab_evidence = st.tabs(["Spec", "Debugger", "Evidence"])
                with tab_spec:
                    if workspace.get("name") and workspace["name"] != "Без workspace":
                        st.caption(f"Workspace: {workspace['name']}")
                    st.markdown(f"- **Цель:** {spec.get('goal') or '—'}")
                    st.markdown(f"- **Типы задач:** {', '.join(spec.get('task_types') or []) or '—'}")
                    st.markdown(f"- **Сложность:** {spec.get('complexity') or '—'}")
                    st.markdown(f"- **Аудитория:** {spec.get('audience') or '—'}")
                    st.markdown(f"- **Формат вывода:** {spec.get('output_format') or '—'}")
                    st.markdown(f"- **Источник истины:** {'; '.join(spec.get('source_of_truth') or []) or '—'}")
                    st.markdown(f"- **Критерии успеха:** {'; '.join(spec.get('success_criteria') or []) or '—'}")
                    st.markdown(f"- **Ограничения:** {'; '.join(spec.get('constraints') or []) or '—'}")
                with tab_debug:
                    if not debug_issues:
                        st.success("Debugger не нашёл критичных проблем в PromptSpec.")
                    else:
                        for issue in debug_issues:
                            st.markdown(f"**[{issue['severity'].upper()}] {issue['message']}**")
                            st.caption(issue["why_it_matters"])
                            st.markdown(f"- Исправление: {issue['suggested_fix']}")
                with tab_evidence:
                    for field, meta in evidence.items():
                        st.markdown(f"- **{field}**: `{meta['source_type']}` ({meta['confidence']:.2f})")
                        if meta.get("value_preview"):
                            st.caption(f"Значение: {meta['value_preview']}")
                        st.caption(meta["reason"])

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
                _log_event("iteration_started", {"has_existing_prompt": True})
                st.session_state.last_result["prompt_block"] = edited_prompt
                st.session_state.iteration_mode = True
                st.rerun()

        with ac3:
            if st.button("Сравнить", use_container_width=True, help="Открыть страницу A/B и сравнить техники на исходной задаче"):
                st.session_state["compare_prompt"] = result.get("task_input", edited_prompt)
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
                        user_id      = get_current_user_id(),
                    )
                    _log_event(
                        "prompt_saved_to_library",
                        {
                            "target_model": result.get("target_model", "unknown"),
                            "task_type": task_types[0] if task_types else "general",
                            "technique_count": len(technique_ids),
                        },
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
