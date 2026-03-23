"""
Обработчики команд и основная логика диалога.
Новая архитектура:
  1. TaskClassifier определяет тип и сложность задачи
  2. TechniqueRegistry выбирает подходящие техники
  3. ContextBuilder собирает system prompt (base + technique cards + prefs + summary)
  4. LLM генерирует ответ с [REASONING]...[PROMPT] блоками
  5. SessionMemory обновляет сжатое резюме сессии
"""
from __future__ import annotations

import logging
import uuid

from aiogram import F, Router
from aiogram.exceptions import TelegramBadRequest
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import Message

from bot.core.context_builder import ContextBuilder
from bot.core.session_memory import SessionMemory
from bot.core.task_classifier import classify_task, get_complexity_label, get_task_types_label
from bot.core.technique_registry import TechniqueRegistry
from bot.db.sqlite_manager import SQLiteManager
from bot.handlers.keyboards import (
    get_agent_questions_keyboard,
    get_agent_result_keyboard,
    get_back_keyboard,
    get_llm_error_keyboard,
    get_main_keyboard,
    get_preference_format_keyboard,
    get_preference_goal_keyboard,
    get_preference_style_keyboard,
    get_settings_keyboard,
    get_simple_result_keyboard,
    get_techniques_list_keyboard,
)
from bot.services.llm_client import LLMService, PROVIDER_NAMES
from core.parsing import PROMPT_CLOSE, PROMPT_OPEN, QUESTIONS_OPEN, parse_questions, parse_reply

logger = logging.getLogger(__name__)
router = Router()

TELEGRAM_MAX = 4096


# ─── FSM States ──────────────────────────────────────────────────────────────

class OnboardingStates(StatesGroup):
    selecting_goals = State()


class AgentStates(StatesGroup):
    answering_questions = State()
    awaiting_custom_answer = State()


class SettingsStates(StatesGroup):
    editing_meta_prompt = State()
    editing_context = State()


# ─── Parsers ─────────────────────────────────────────────────────────────────

def _html_escape(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# ─── Helpers для отправки ─────────────────────────────────────────────────────

async def send_prompt_block(message: Message, prompt_text: str, footer: str = "", reply_markup=None) -> None:
    """Отправляет промпт в копируемом blockquote+pre блоке."""
    escaped = _html_escape(prompt_text)
    block = f"<blockquote><pre>{escaped}</pre></blockquote>"

    if footer:
        footer_escaped = _html_escape(footer) if footer else ""
        full = f"{block}\n\n{footer_escaped}"
    else:
        full = block

    if len(full) <= TELEGRAM_MAX:
        await message.answer(full, parse_mode="HTML", reply_markup=reply_markup)
        return

    # Разбиваем большой промпт на части
    chunks = []
    max_chunk = TELEGRAM_MAX - 100
    start = 0
    while start < len(escaped):
        end = min(start + max_chunk, len(escaped))
        if end < len(escaped):
            nl = escaped.rfind("\n", start, end + 1)
            if nl >= start:
                end = nl + 1
        chunks.append(escaped[start:end])
        start = end

    for i, chunk in enumerate(chunks):
        is_last = i == len(chunks) - 1
        part = f"<blockquote><pre>{chunk}</pre></blockquote>"
        if is_last and footer:
            part += f"\n\n{_html_escape(footer)}"
        await message.answer(
            part,
            parse_mode="HTML",
            reply_markup=reply_markup if is_last else None,
        )


def _is_provider_error(exc: Exception) -> bool:
    name = type(exc).__name__
    msg = str(exc).lower()
    return (
        name in ("PermissionDeniedError", "AuthenticationError")
        or any(s in msg for s in ("403", "not available", "your region", "provider returned error"))
    )


def _metrics_line(original: str, optimized: str) -> str:
    if not optimized.strip() or not original.strip():
        return ""
    orig_len, opt_len = len(original), len(optimized)
    pct = (opt_len - orig_len) / orig_len * 100 if orig_len else 0
    orig_words = len(original.split())
    opt_words = len(optimized.split())
    diff_w = opt_words - orig_words
    if pct > 20:
        note = "добавлена структура и детали"
    elif pct < -20:
        note = "убрана лишняя информация"
    else:
        note = "улучшена формулировка"
    return (
        f"📈 {orig_len} → {opt_len} симв. ({pct:+.1f}%) | "
        f"{orig_words} → {opt_words} слов ({diff_w:+d}) — {note}"
    )


# ─── /start ──────────────────────────────────────────────────────────────────

@router.message(Command("start"))
async def cmd_start(message: Message, db: SQLiteManager, state: FSMContext):
    user = await db.get_or_create_user(message.from_user.id)

    if not user.get("preference_style"):
        await state.clear()
        await message.answer(
            "👋 Привет! Я — профессиональный помощник по созданию промптов для LLM.\n\n"
            "Я знаю техники промптинга и умею выбирать лучшую для каждой задачи.\n\n"
            "Пару вопросов для настройки — как тебе удобнее получать ответы?",
            reply_markup=get_preference_style_keyboard(),
        )
        return

    if not user.get("preference_goal"):
        selected = [g.strip() for g in (user.get("preference_goal") or "").split(",") if g.strip()]
        await state.set_state(OnboardingStates.selecting_goals)
        await state.update_data(selected_goals=selected)
        await message.answer(
            "Выбери области, для которых чаще всего создаёшь промпты (можно несколько):",
            reply_markup=get_preference_goal_keyboard(selected),
        )
        return

    if not user.get("preference_format"):
        await message.answer(
            "Какой формат промптов тебе ближе?",
            reply_markup=get_preference_format_keyboard(),
        )
        return

    await message.answer(
        "👋 Привет! Я — prompt engineering агент.\n\n"
        "Отправь мне задачу или сырой промпт — я:\n"
        "• определю тип задачи и выберу лучшую технику\n"
        "• задам уточняющие вопросы если нужно\n"
        "• создам профессиональный промпт с объяснением\n\n"
        "📚 /techniques — база знаний техник\n"
        "⚙️ /settings — настройки модели и режима",
        reply_markup=get_main_keyboard(),
    )


@router.message(Command("help"))
async def cmd_help(message: Message):
    await message.answer(
        "📖 <b>Как пользоваться:</b>\n\n"
        "Просто отправь текст — задачу или сырой промпт.\n\n"
        "<b>Агент:</b>\n"
        "• Определяет тип задачи автоматически\n"
        "• Выбирает технику из базы знаний\n"
        "• Может задать уточняющие вопросы\n"
        "• Показывает reasoning — почему выбрана эта техника\n\n"
        "<b>Кнопки после ответа:</b>\n"
        "• 💡 Почему так? — объяснение применённых техник\n"
        "• 🔄 Улучшить — итерация промпта\n"
        "• 📜 Версии — история изменений промпта\n\n"
        "/settings — модель, режим, предпочтения\n"
        "/techniques — база знаний техник",
        parse_mode="HTML",
    )


@router.message(Command("techniques"))
async def cmd_techniques(message: Message, registry: TechniqueRegistry):
    all_techs = registry.get_all()
    names = {t["id"]: t.get("name", t["id"]) for t in all_techs}
    await message.answer(
        f"📚 <b>База знаний техник промптинга</b>\n\n"
        f"Загружено техник: {len(all_techs)}\n\n"
        f"Выбери технику для подробного объяснения:",
        parse_mode="HTML",
        reply_markup=get_techniques_list_keyboard(list(names.keys()), names),
    )


@router.message(Command("settings"))
async def cmd_settings(message: Message, db: SQLiteManager):
    user = await db.get_or_create_user(message.from_user.id)
    provider = user.get("llm_provider", "trinity")
    mode = user.get("mode", "agent")
    mode_label = "Агент 🤖" if mode == "agent" else "Простой ⚡"
    pname = PROVIDER_NAMES.get(provider, provider)
    await message.answer(
        f"⚙️ <b>Настройки</b>\n\n"
        f"Модель: {pname}\n"
        f"Режим: {mode_label}\n"
        f"Температура: {user.get('temperature', 0.4)}",
        parse_mode="HTML",
        reply_markup=get_settings_keyboard(provider, mode),
    )


# ─── Основной обработчик промптов ────────────────────────────────────────────

@router.message(F.text, ~F.text.startswith("/"))
async def handle_prompt(
    message: Message,
    db: SQLiteManager,
    llm: LLMService,
    registry: TechniqueRegistry,
    state: FSMContext,
):
    user_id = message.from_user.id
    user_input = message.text.strip()
    user = await db.get_or_create_user(user_id)
    mode = user.get("mode", "agent")
    provider = user.get("llm_provider", "trinity")
    temperature = float(user.get("temperature", 0.4))

    # Свой ответ на уточняющий вопрос
    if await state.get_state() == AgentStates.awaiting_custom_answer.state:
        data = await state.get_data()
        q_idx = data.get("agent_custom_q_idx", 0)
        custom_answers: dict = data.get("agent_custom_answers", {})
        custom_answers[q_idx] = user_input
        await state.update_data(agent_custom_answers=custom_answers)
        await state.set_state(AgentStates.answering_questions)
        questions = data.get("agent_questions", [])
        answers = data.get("agent_answers", {})
        if q_idx < len(questions):
            q = questions[q_idx]
            await message.answer(
                _html_escape(q["question"]),
                parse_mode="HTML",
                reply_markup=get_agent_questions_keyboard(questions, answers, q_idx, custom_answers),
            )
        return

    # Сбрасываем FSM если был в состоянии вопросов
    if await state.get_state() == AgentStates.answering_questions.state:
        await state.clear()

    if mode == "simple":
        await _handle_simple(message, user_input, user, db, llm, registry, provider, temperature)
    else:
        await _handle_agent(message, user_input, user, db, llm, registry, state, provider, temperature)


async def _handle_simple(
    message: Message,
    user_input: str,
    user: dict,
    db: SQLiteManager,
    llm: LLMService,
    registry: TechniqueRegistry,
    provider: str,
    temperature: float,
) -> None:
    """Простой режим: однократный вызов с выбором техник."""
    processing = await message.answer("⚡ Обрабатываю...")
    try:
        classification = classify_task(user_input)
        task_types = classification["task_types"]
        complexity = classification["complexity"]

        techniques = registry.select_techniques(task_types, complexity, max_techniques=2)
        technique_ids = [t["id"] for t in techniques]

        builder = ContextBuilder(registry)
        system_prompt = builder.build_system_prompt(
            technique_ids=technique_ids,
            user_preferences=user,
        )
        user_content = builder.build_user_content(user_input, task_classification=classification)

        reply = await llm.chat_with_history(
            user_content=user_content,
            history=[],
            system_prompt=system_prompt,
            provider=provider,
            temperature=temperature,
        )

        parsed = parse_reply(reply)
        await processing.delete()

        if parsed["has_prompt"]:
            metrics = _metrics_line(user_input, parsed["prompt_block"])
            tech_names = ", ".join(t.get("name", t["id"]) for t in techniques)
            footer = f"🔧 Техники: {tech_names}"
            if metrics:
                footer += f"\n{metrics}"
            await send_prompt_block(message, parsed["prompt_block"], footer=footer, reply_markup=get_simple_result_keyboard())
        else:
            safe = _html_escape((parsed.get("text") or reply)[:3800])
            await message.answer(safe, parse_mode="HTML", reply_markup=get_simple_result_keyboard())

    except Exception as e:
        logger.error("Simple mode error: %s", e, exc_info=True)
        try:
            await processing.delete()
        except Exception:
            pass
        if _is_provider_error(e):
            pname = PROVIDER_NAMES.get(provider, provider)
            await message.answer(
                f"❌ Модель <b>{pname}</b> недоступна.\nВыберите другую модель.",
                parse_mode="HTML",
                reply_markup=get_llm_error_keyboard(),
            )
        else:
            await message.answer(f"❌ Ошибка: {type(e).__name__}. Попробуйте позже.")


async def _handle_agent(
    message: Message,
    user_input: str,
    user: dict,
    db: SQLiteManager,
    llm: LLMService,
    registry: TechniqueRegistry,
    state: FSMContext,
    provider: str,
    temperature: float,
) -> None:
    """Агентный режим: диалог с памятью, классификацией и выбором техник."""
    user_id = message.from_user.id
    processing = await message.answer("🔄 Думаю...")

    try:
        # Классификация задачи
        classification = classify_task(user_input)
        task_types = classification["task_types"]
        complexity = classification["complexity"]

        # Выбор техник
        techniques = registry.select_techniques(task_types, complexity, max_techniques=3)
        technique_ids = [t["id"] for t in techniques]

        # Память сессии
        memory = SessionMemory(db, llm)
        ctx = await memory.get_context(user_id)
        history = ctx["recent_history"]
        session_summary = ctx["summary"]

        # Последний промпт из истории (для итераций)
        previous_prompt = await memory.get_last_agent_prompt(user_id)

        # Сборка контекста
        builder = ContextBuilder(registry)
        system_prompt = builder.build_system_prompt(
            technique_ids=technique_ids,
            user_preferences=user,
            session_summary=session_summary,
        )
        user_content = builder.build_user_content(
            user_input,
            previous_agent_prompt=previous_prompt,
            task_classification=classification,
        )

        # LLM вызов
        reply = await llm.chat_with_history(
            user_content=user_content,
            history=history,
            system_prompt=system_prompt,
            provider=provider,
            temperature=temperature,
        )

        parsed = parse_reply(reply)
        await processing.delete()

        # Сохраняем reasoning и технику в FSM для кнопки "Почему так"
        reasoning_text = parsed.get("reasoning", "")
        tech_names = ", ".join(t.get("name", t["id"]) for t in techniques)
        task_label = get_task_types_label(task_types)
        complexity_label = get_complexity_label(complexity)

        await state.update_data(
            last_reasoning=reasoning_text,
            last_techniques=technique_ids,
            last_tech_names=tech_names,
            last_task_label=task_label,
            last_complexity=complexity_label,
            last_prompt=parsed.get("prompt_block", ""),
            last_session_uuid=str(uuid.uuid4()),
            agent_original_request=user_input,
        )

        # Уточняющие вопросы
        if parsed["has_questions"] and not parsed["has_prompt"]:
            questions = parse_questions(parsed["questions_raw"])
            if questions:
                await state.set_state(AgentStates.answering_questions)
                await state.update_data(
                    agent_questions=questions,
                    agent_answers={},
                    agent_custom_answers={},
                    agent_provider=provider,
                    agent_technique_ids=technique_ids,
                )
                intro_text = parsed["text"].split(QUESTIONS_OPEN)[0].strip() if QUESTIONS_OPEN in parsed["text"] else ""
                for i, q in enumerate(questions):
                    text = _html_escape(q["question"])
                    if intro_text and i == 0:
                        text = _html_escape(intro_text) + "\n\n" + text
                    await message.answer(
                        text,
                        parse_mode="HTML",
                        reply_markup=get_agent_questions_keyboard(questions, {}, i, {}),
                    )
                return

        # Готовый промпт
        if parsed["has_prompt"]:
            await db.add_agent_message(user_id, "user", user_input)
            await db.add_agent_message(user_id, "assistant", reply)

            prompt_block = parsed["prompt_block"]
            metrics = _metrics_line(previous_prompt or user_input, prompt_block)
            tech_line = f"🔧 {task_label} · {complexity_label} · техники: {tech_names}"
            footer = tech_line + (f"\n{metrics}" if metrics else "")

            if parsed["text"]:
                intro = parsed["text"].replace(PROMPT_OPEN, "").replace(PROMPT_CLOSE, "").strip()
                if intro:
                    await message.answer(_html_escape(intro[:1500]), parse_mode="HTML")

            await send_prompt_block(
                message,
                prompt_block,
                footer=footer,
                reply_markup=get_agent_result_keyboard(),
            )

            # Сохраняем версию
            fsm_data = await state.get_data()
            session_uuid = fsm_data.get("last_session_uuid", str(uuid.uuid4()))
            await db.save_prompt_version(
                user_id=user_id,
                session_uuid=session_uuid,
                version=1,
                task_types=task_types,
                complexity=complexity,
                techniques_used=technique_ids,
                original_request=user_input,
                reasoning=reasoning_text,
                final_prompt=prompt_block,
            )
        else:
            # Текстовый ответ без промпта
            text = parsed.get("text") or reply
            await message.answer(_html_escape(text[:3800]), parse_mode="HTML", reply_markup=get_agent_result_keyboard())

    except Exception as e:
        logger.error("Agent mode error: %s", e, exc_info=True)
        try:
            await processing.delete()
        except Exception:
            pass
        if _is_provider_error(e):
            pname = PROVIDER_NAMES.get(provider, provider)
            await message.answer(
                f"❌ Модель <b>{pname}</b> недоступна.\nВыберите другую модель.",
                parse_mode="HTML",
                reply_markup=get_llm_error_keyboard(),
            )
        else:
            await message.answer(f"❌ Ошибка: {type(e).__name__}. Попробуйте позже.")


# ─── Settings editing ─────────────────────────────────────────────────────────

@router.message(SettingsStates.editing_meta_prompt)
async def handle_meta_edit(message: Message, state: FSMContext, db: SQLiteManager):
    await db.update_user_setting(message.from_user.id, "meta_prompt", message.text)
    await state.clear()
    await message.answer("✅ Системный промпт обновлён.", reply_markup=get_back_keyboard("nav_settings"))


@router.message(SettingsStates.editing_context)
async def handle_context_edit(message: Message, state: FSMContext, db: SQLiteManager):
    await db.update_user_setting(message.from_user.id, "context_prompt", message.text)
    await state.clear()
    await message.answer("✅ Контекст обновлён.", reply_markup=get_back_keyboard("nav_settings"))
