"""
Обработчики inline callback кнопок.
"""
from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery

from bot.core.context_builder import ContextBuilder
from bot.core.technique_registry import TechniqueRegistry
from bot.db.sqlite_manager import SQLiteManager
from bot.handlers.commands import (
    AgentStates,
    OnboardingStates,
    _html_escape,
    parse_questions,
    send_prompt_block,
    _metrics_line,
    _handle_agent,
)
from bot.handlers.keyboards import (
    get_agent_questions_keyboard,
    get_agent_result_keyboard,
    get_back_keyboard,
    get_llm_keyboard,
    get_llm_error_keyboard,
    get_main_keyboard,
    get_mode_keyboard,
    get_preference_format_keyboard,
    get_preference_goal_keyboard,
    get_preference_style_keyboard,
    get_settings_keyboard,
    get_techniques_list_keyboard,
    get_temperature_keyboard,
)
from bot.services.llm_client import LLMService, PROVIDER_NAMES

logger = logging.getLogger(__name__)
router = Router()

GOAL_SELECT_TEXT = "Выбери области применения (можно несколько, до 5):"


# ─── Navigation ──────────────────────────────────────────────────────────────

@router.callback_query(F.data == "nav_main")
async def cb_nav_main(cq: CallbackQuery):
    await cq.message.edit_text(
        "👋 Отправь задачу или сырой промпт — я помогу сделать его профессиональным.",
        reply_markup=get_main_keyboard(),
    )
    await cq.answer()


@router.callback_query(F.data == "nav_settings")
async def cb_nav_settings(cq: CallbackQuery, db: SQLiteManager):
    user = await db.get_or_create_user(cq.from_user.id)
    provider = user.get("llm_provider", "trinity")
    mode = user.get("mode", "agent")
    pname = PROVIDER_NAMES.get(provider, provider)
    mode_label = "Агент 🤖" if mode == "agent" else "Простой ⚡"
    await cq.message.edit_text(
        f"⚙️ <b>Настройки</b>\n\nМодель: {pname}\nРежим: {mode_label}\nТемпература: {user.get('temperature', 0.4)}",
        parse_mode="HTML",
        reply_markup=get_settings_keyboard(provider, mode),
    )
    await cq.answer()


@router.callback_query(F.data == "nav_techniques")
async def cb_nav_techniques(cq: CallbackQuery, registry: TechniqueRegistry):
    all_techs = registry.get_all()
    names = {t["id"]: t.get("name", t["id"]) for t in all_techs}
    await cq.message.edit_text(
        f"📚 <b>База знаний техник промптинга</b>\n\nЗагружено: {len(all_techs)} техник\n\nВыбери для подробного объяснения:",
        parse_mode="HTML",
        reply_markup=get_techniques_list_keyboard(list(names.keys()), names),
    )
    await cq.answer()


# ─── Settings ─────────────────────────────────────────────────────────────────

@router.callback_query(F.data == "settings_llm")
async def cb_settings_llm(cq: CallbackQuery, db: SQLiteManager):
    user = await db.get_or_create_user(cq.from_user.id)
    await cq.message.edit_text(
        "🤖 Выбери языковую модель:",
        reply_markup=get_llm_keyboard(user.get("llm_provider", "trinity")),
    )
    await cq.answer()


@router.callback_query(F.data.startswith("llm_"))
async def cb_set_llm(cq: CallbackQuery, db: SQLiteManager):
    provider = cq.data.removeprefix("llm_")
    if provider not in PROVIDER_NAMES:
        await cq.answer("Неизвестная модель", show_alert=True)
        return
    await db.update_user_setting(cq.from_user.id, "llm_provider", provider)
    pname = PROVIDER_NAMES[provider]
    await cq.message.edit_text(
        f"✅ Модель изменена на <b>{pname}</b>",
        parse_mode="HTML",
        reply_markup=get_back_keyboard("nav_settings"),
    )
    await cq.answer(f"Выбрано: {pname}")


@router.callback_query(F.data == "settings_mode")
async def cb_settings_mode(cq: CallbackQuery, db: SQLiteManager):
    user = await db.get_or_create_user(cq.from_user.id)
    await cq.message.edit_text(
        "⚡ Выбери режим работы:\n\n"
        "🤖 <b>Агент</b> — диалог с памятью, задаёт уточняющие вопросы, выбирает техники\n"
        "⚡ <b>Простой</b> — быстрое улучшение промпта за один вызов",
        parse_mode="HTML",
        reply_markup=get_mode_keyboard(user.get("mode", "agent")),
    )
    await cq.answer()


@router.callback_query(F.data.startswith("mode_"))
async def cb_set_mode(cq: CallbackQuery, db: SQLiteManager):
    mode = cq.data.removeprefix("mode_")
    if mode not in ("agent", "simple"):
        await cq.answer("Неизвестный режим")
        return
    await db.update_user_setting(cq.from_user.id, "mode", mode)
    if mode == "agent":
        await db.clear_agent_history(cq.from_user.id)
        await db.update_session_summary(cq.from_user.id, "")
    label = "Агент 🤖" if mode == "agent" else "Простой ⚡"
    await cq.message.edit_text(
        f"✅ Режим: <b>{label}</b>",
        parse_mode="HTML",
        reply_markup=get_back_keyboard("nav_settings"),
    )
    await cq.answer()


@router.callback_query(F.data == "settings_temperature")
async def cb_settings_temp(cq: CallbackQuery, db: SQLiteManager):
    user = await db.get_or_create_user(cq.from_user.id)
    await cq.message.edit_text(
        "🌡 Выбери температуру:\n(чем выше — тем креативнее и менее предсказуемо)",
        reply_markup=get_temperature_keyboard(float(user.get("temperature", 0.4))),
    )
    await cq.answer()


@router.callback_query(F.data.startswith("temp_"))
async def cb_set_temp(cq: CallbackQuery, db: SQLiteManager):
    val_str = cq.data.removeprefix("temp_")
    try:
        val = float(val_str)
        assert 0.0 <= val <= 1.0
    except Exception:
        await cq.answer("Неверное значение")
        return
    await db.update_user_setting(cq.from_user.id, "temperature", val)
    await cq.message.edit_text(
        f"✅ Температура: <b>{val}</b>",
        parse_mode="HTML",
        reply_markup=get_back_keyboard("nav_settings"),
    )
    await cq.answer()


@router.callback_query(F.data == "settings_preferences")
async def cb_settings_pref(cq: CallbackQuery):
    await cq.message.edit_text(
        "🎨 Как тебе удобнее получать ответы?",
        reply_markup=get_preference_style_keyboard(),
    )
    await cq.answer()


# ─── Onboarding / Preferences ─────────────────────────────────────────────────

@router.callback_query(F.data.startswith("pref_style_"))
async def cb_pref_style(cq: CallbackQuery, db: SQLiteManager, state: FSMContext):
    style = cq.data.removeprefix("pref_style_")
    await db.update_user_setting(cq.from_user.id, "preference_style", style)
    user = await db.get_or_create_user(cq.from_user.id)
    selected = [g.strip() for g in (user.get("preference_goal") or "").split(",") if g.strip()]
    await state.set_state(OnboardingStates.selecting_goals)
    await state.update_data(selected_goals=selected)
    await cq.message.edit_text(
        GOAL_SELECT_TEXT,
        reply_markup=get_preference_goal_keyboard(selected),
    )
    await cq.answer()


@router.callback_query(F.data.startswith("pref_goal_"), ~F.data.endswith("done"))
async def cb_pref_goal_toggle(cq: CallbackQuery, state: FSMContext):
    goal = cq.data.removeprefix("pref_goal_")
    data = await state.get_data()
    selected: list[str] = data.get("selected_goals", [])
    if goal in selected:
        selected.remove(goal)
    else:
        if len(selected) < 5:
            selected.append(goal)
    await state.update_data(selected_goals=selected)
    await cq.message.edit_reply_markup(reply_markup=get_preference_goal_keyboard(selected))
    await cq.answer()


@router.callback_query(F.data == "pref_goal_done")
async def cb_pref_goal_done(cq: CallbackQuery, db: SQLiteManager, state: FSMContext):
    data = await state.get_data()
    selected: list[str] = data.get("selected_goals", [])
    if selected:
        await db.update_user_setting(cq.from_user.id, "preference_goal", ",".join(selected))
    await state.clear()
    await cq.message.edit_text(
        "Какой формат промптов тебе ближе?",
        reply_markup=get_preference_format_keyboard(),
    )
    await cq.answer()


@router.callback_query(F.data.startswith("pref_format_"))
async def cb_pref_format(cq: CallbackQuery, db: SQLiteManager):
    fmt = cq.data.removeprefix("pref_format_")
    await db.update_user_setting(cq.from_user.id, "preference_format", fmt)
    await cq.message.edit_text(
        "✅ Настройки сохранены!\n\n"
        "Теперь отправляй задачи или промпты — я помогу их улучшить.\n\n"
        "/techniques — база техник промптинга",
        reply_markup=get_main_keyboard(),
    )
    await cq.answer()


# ─── Техники ──────────────────────────────────────────────────────────────────

@router.callback_query(F.data.startswith("tech_explain_"))
async def cb_tech_explain(cq: CallbackQuery, registry: TechniqueRegistry):
    tech_id = cq.data.removeprefix("tech_explain_")
    explanation = registry.explain_technique(tech_id)
    all_techs = registry.get_all()
    names = {t["id"]: t.get("name", t["id"]) for t in all_techs}
    await cq.message.edit_text(
        explanation,
        parse_mode="HTML",
        reply_markup=get_back_keyboard("nav_techniques"),
    )
    await cq.answer()


# ─── Агентный Q&A ─────────────────────────────────────────────────────────────

@router.callback_query(F.data.startswith("aq_") & ~F.data.endswith("next") & ~F.data.endswith("skip"))
async def cb_answer_question(cq: CallbackQuery, state: FSMContext):
    parts = cq.data.split("_")
    if len(parts) < 3:
        await cq.answer()
        return
    try:
        q_idx = int(parts[1])
        opt_idx = int(parts[2])
    except ValueError:
        await cq.answer()
        return

    data = await state.get_data()
    answers: dict = data.get("agent_answers", {})
    q_answers: list = answers.get(q_idx, [])
    if opt_idx in q_answers:
        q_answers.remove(opt_idx)
    else:
        q_answers.append(opt_idx)
    answers[q_idx] = q_answers
    await state.update_data(agent_answers=answers)

    questions = data.get("agent_questions", [])
    # Обновляем разметку текущего вопроса
    # Определяем, к какому вопросу относится это сообщение
    await cq.message.edit_reply_markup(
        reply_markup=get_agent_questions_keyboard(questions, answers, q_idx)
    )
    await cq.answer()


@router.callback_query(F.data == "aq_next")
async def cb_question_next(cq: CallbackQuery, state: FSMContext, db: SQLiteManager, llm: LLMService, registry: TechniqueRegistry):
    data = await state.get_data()
    questions: list[dict] = data.get("agent_questions", [])
    answers: dict = data.get("agent_answers", {})

    # Находим текущий вопрос по индексу в сообщении
    # Используем счётчик в state для отслеживания текущего вопроса
    current_q = data.get("current_question_idx", 0)
    next_q = current_q + 1

    if next_q < len(questions):
        await state.update_data(current_question_idx=next_q)
        q = questions[next_q]
        await cq.message.answer(
            _html_escape(q["question"]),
            parse_mode="HTML",
            reply_markup=get_agent_questions_keyboard(questions, answers, next_q),
        )
        await cq.answer()
    else:
        # Все вопросы пройдены — генерируем промпт
        await _generate_from_answers(cq, state, db, llm, registry, answers, questions)


@router.callback_query(F.data == "aq_skip")
async def cb_question_skip(cq: CallbackQuery, state: FSMContext, db: SQLiteManager, llm: LLMService, registry: TechniqueRegistry):
    data = await state.get_data()
    questions = data.get("agent_questions", [])
    answers = data.get("agent_answers", {})
    await _generate_from_answers(cq, state, db, llm, registry, answers, questions)


async def _generate_from_answers(
    cq: CallbackQuery,
    state: FSMContext,
    db: SQLiteManager,
    llm: LLMService,
    registry: TechniqueRegistry,
    answers: dict,
    questions: list[dict],
):
    data = await state.get_data()
    original_request = data.get("agent_original_request", "")
    provider = data.get("agent_provider", "trinity")
    technique_ids = data.get("agent_technique_ids", [])
    user_id = cq.from_user.id

    await state.clear()

    # Формируем текст с ответами
    answers_text = ""
    for i, q in enumerate(questions):
        selected_indices = answers.get(i, [])
        if selected_indices:
            selected_opts = [q["options"][j] for j in selected_indices if j < len(q["options"])]
            answers_text += f"\n{q['question']}: {', '.join(selected_opts)}"

    if not answers_text.strip():
        answers_text = " (пользователь пропустил вопросы)"

    processing = await cq.message.answer("🔄 Составляю промпт...")

    try:
        user = await db.get_or_create_user(user_id)
        temperature = float(user.get("temperature", 0.4))

        builder = ContextBuilder(registry)
        system_prompt = builder.build_system_prompt(
            technique_ids=technique_ids,
            user_preferences=user,
        )

        combined_input = (
            f"Исходный запрос: {original_request}\n\n"
            f"Ответы на уточняющие вопросы:{answers_text}\n\n"
            "На основе этого верни готовый промпт в блоке [PROMPT]...[/PROMPT]."
        )

        reply = await llm.chat_with_history(
            user_content=combined_input,
            history=[],
            system_prompt=system_prompt,
            provider=provider,
            temperature=temperature,
        )

        from bot.handlers.commands import parse_reply
        parsed = parse_reply(reply)
        await processing.delete()

        if parsed["has_prompt"]:
            await db.add_agent_message(user_id, "user", combined_input)
            await db.add_agent_message(user_id, "assistant", reply)
            techniques = [registry.get(tid) for tid in technique_ids if registry.get(tid)]
            tech_names = ", ".join(t.get("name", t["id"]) for t in techniques)
            metrics = _metrics_line(original_request, parsed["prompt_block"])
            footer = f"🔧 Техники: {tech_names}" + (f"\n{metrics}" if metrics else "")
            await send_prompt_block(
                cq.message,
                parsed["prompt_block"],
                footer=footer,
                reply_markup=get_agent_result_keyboard(),
            )
        else:
            text = parsed.get("text") or reply
            await cq.message.answer(_html_escape(text[:3800]), parse_mode="HTML", reply_markup=get_agent_result_keyboard())

    except Exception as e:
        logger.error("Generate from answers error: %s", e, exc_info=True)
        try:
            await processing.delete()
        except Exception:
            pass
        if _is_provider_error(e):
            pname = PROVIDER_NAMES.get(provider, provider)
            await cq.message.answer(
                f"❌ Модель <b>{pname}</b> недоступна.",
                parse_mode="HTML",
                reply_markup=get_llm_error_keyboard(),
            )
        else:
            await cq.message.answer(f"❌ Ошибка: {type(e).__name__}")

    await cq.answer()


def _is_provider_error(exc: Exception) -> bool:
    name = type(exc).__name__
    msg = str(exc).lower()
    return (
        name in ("PermissionDeniedError", "AuthenticationError")
        or any(s in msg for s in ("403", "not available", "your region", "provider returned error"))
    )


# ─── Результат агента ─────────────────────────────────────────────────────────

@router.callback_query(F.data == "show_reasoning")
async def cb_show_reasoning(cq: CallbackQuery, state: FSMContext, registry: TechniqueRegistry):
    data = await state.get_data()
    reasoning = data.get("last_reasoning", "")
    technique_ids = data.get("last_techniques", [])
    task_label = data.get("last_task_label", "")
    complexity = data.get("last_complexity", "")
    tech_names = data.get("last_tech_names", "")

    lines = [f"💡 <b>Почему именно такой промпт?</b>"]
    if task_label:
        lines.append(f"\n<b>Тип задачи:</b> {_html_escape(task_label)}")
    if complexity:
        lines.append(f"<b>Сложность:</b> {_html_escape(complexity)}")
    if tech_names:
        lines.append(f"<b>Применённые техники:</b> {_html_escape(tech_names)}")

    if reasoning:
        lines.append(f"\n<b>Внутреннее рассуждение агента:</b>\n<i>{_html_escape(reasoning[:1200])}</i>")

    if technique_ids:
        lines.append("\n<b>Подробнее о техниках:</b>")
        for tid in technique_ids[:3]:
            tech = registry.get(tid)
            if tech:
                why = (tech.get("why_it_works") or "")[:200]
                lines.append(f"• <b>{tech.get('name', tid)}</b>: {_html_escape(why.strip())}")

    text = "\n".join(lines)
    try:
        await cq.message.answer(text, parse_mode="HTML", reply_markup=get_back_keyboard("nav_main"))
    except Exception:
        await cq.message.answer(text[:3800], parse_mode="HTML", reply_markup=get_back_keyboard("nav_main"))
    await cq.answer()


@router.callback_query(F.data == "agent_continue")
async def cb_agent_continue(cq: CallbackQuery):
    await cq.message.answer(
        "✏️ Напиши правки или уточнения к промпту — я обновлю его.",
    )
    await cq.answer()


@router.callback_query(F.data == "agent_accept")
async def cb_agent_accept(cq: CallbackQuery, db: SQLiteManager, state: FSMContext):
    await db.clear_agent_history(cq.from_user.id)
    await db.update_session_summary(cq.from_user.id, "")
    await state.clear()
    await cq.message.answer(
        "✅ Промпт принят! История сессии очищена.\n\nОтправь новую задачу.",
        reply_markup=get_main_keyboard(),
    )
    await cq.answer("Сессия завершена")


@router.callback_query(F.data == "agent_reset")
async def cb_agent_reset(cq: CallbackQuery, db: SQLiteManager, state: FSMContext):
    await db.clear_agent_history(cq.from_user.id)
    await db.update_session_summary(cq.from_user.id, "")
    await state.clear()
    await cq.message.answer("🗑 История очищена. Начинай новую задачу!")
    await cq.answer()


@router.callback_query(F.data == "simple_improve")
async def cb_simple_improve(cq: CallbackQuery):
    await cq.message.answer("✏️ Отправь промпт ещё раз для повторного улучшения.")
    await cq.answer()
