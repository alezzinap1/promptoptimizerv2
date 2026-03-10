"""Фабрики инлайн-клавиатур."""
from __future__ import annotations

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder

from bot.services.llm_client import PROVIDER_NAMES


def get_main_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.row(InlineKeyboardButton(text="⚙️ Настройки", callback_data="nav_settings"))
    builder.row(InlineKeyboardButton(text="📚 База техник", callback_data="nav_techniques"))
    return builder.as_markup()


def get_settings_keyboard(current_provider: str = "trinity", current_mode: str = "agent") -> InlineKeyboardMarkup:
    mode_label = "Агент 🤖" if current_mode == "agent" else "Простой ⚡"
    builder = InlineKeyboardBuilder()
    builder.row(InlineKeyboardButton(text=f"🤖 Модель: {PROVIDER_NAMES.get(current_provider, current_provider)}", callback_data="settings_llm"))
    builder.row(InlineKeyboardButton(text=f"⚡ Режим: {mode_label}", callback_data="settings_mode"))
    builder.row(InlineKeyboardButton(text="🎨 Предпочтения", callback_data="settings_preferences"))
    builder.row(InlineKeyboardButton(text="🌡 Температура", callback_data="settings_temperature"))
    builder.row(InlineKeyboardButton(text="◀ Назад", callback_data="nav_main"))
    return builder.as_markup()


def get_llm_keyboard(current: str = "trinity") -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    for provider_id, name in PROVIDER_NAMES.items():
        mark = "✅ " if provider_id == current else ""
        builder.row(InlineKeyboardButton(text=f"{mark}{name}", callback_data=f"llm_{provider_id}"))
    builder.row(InlineKeyboardButton(text="◀ Назад", callback_data="nav_settings"))
    return builder.as_markup()


def get_mode_keyboard(current: str = "agent") -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    for mode_id, label in [("agent", "🤖 Агент (диалог с памятью)"), ("simple", "⚡ Простой (быстро)")]:
        mark = "✅ " if mode_id == current else ""
        builder.row(InlineKeyboardButton(text=f"{mark}{label}", callback_data=f"mode_{mode_id}"))
    builder.row(InlineKeyboardButton(text="◀ Назад", callback_data="nav_settings"))
    return builder.as_markup()


def get_temperature_keyboard(current: float = 0.4) -> InlineKeyboardMarkup:
    temps = [("0.1", "Точный"), ("0.3", "Сбалансированный"), ("0.5", "Стандартный"),
             ("0.7", "Творческий"), ("0.9", "Максимально творческий")]
    builder = InlineKeyboardBuilder()
    for val, label in temps:
        mark = "✅ " if abs(float(val) - current) < 0.05 else ""
        builder.row(InlineKeyboardButton(text=f"{mark}{val} — {label}", callback_data=f"temp_{val}"))
    builder.row(InlineKeyboardButton(text="◀ Назад", callback_data="nav_settings"))
    return builder.as_markup()


def get_preference_style_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    options = [
        ("precise", "⚡ Точные и лаконичные"),
        ("balanced", "⚖️ Сбалансированные"),
        ("creative", "🎨 Развёрнутые с примерами"),
    ]
    for val, label in options:
        builder.row(InlineKeyboardButton(text=label, callback_data=f"pref_style_{val}"))
    return builder.as_markup()


def get_preference_goal_keyboard(selected: list[str] | None = None) -> InlineKeyboardMarkup:
    selected = selected or []
    goals = [
        ("code", "💻 Код и разработка"),
        ("analysis", "📊 Анализ данных"),
        ("creative", "✍️ Тексты и креатив"),
        ("work", "💼 Работа и бизнес"),
        ("research", "🔬 Исследования"),
        ("writing", "📝 Редактура"),
        ("learning", "🎓 Обучение"),
        ("other", "🔧 Разное"),
    ]
    builder = InlineKeyboardBuilder()
    for val, label in goals:
        mark = "✅ " if val in selected else ""
        builder.row(InlineKeyboardButton(text=f"{mark}{label}", callback_data=f"pref_goal_{val}"))
    builder.row(InlineKeyboardButton(text="✅ Готово", callback_data="pref_goal_done"))
    return builder.as_markup()


def get_preference_format_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    options = [
        ("short", "⚡ Короткие и чёткие"),
        ("structured", "📋 Структурированные"),
        ("detailed", "📖 Подробные с инструкциями"),
    ]
    for val, label in options:
        builder.row(InlineKeyboardButton(text=label, callback_data=f"pref_format_{val}"))
    return builder.as_markup()


def get_agent_result_keyboard(has_versions: bool = False, version_info: str = "") -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.row(InlineKeyboardButton(text="💡 Почему так?", callback_data="show_reasoning"))
    builder.row(InlineKeyboardButton(text="🔄 Улучшить", callback_data="agent_continue"))
    if has_versions:
        builder.row(InlineKeyboardButton(text=f"📜 Версии ({version_info})", callback_data="show_versions"))
    builder.row(InlineKeyboardButton(text="✅ Принять", callback_data="agent_accept"))
    builder.row(InlineKeyboardButton(text="🗑 Начать заново", callback_data="agent_reset"))
    return builder.as_markup()


def get_simple_result_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.row(InlineKeyboardButton(text="🔄 Улучшить ещё", callback_data="simple_improve"))
    builder.row(InlineKeyboardButton(text="⚙️ Настройки", callback_data="nav_settings"))
    return builder.as_markup()


def get_agent_questions_keyboard(
    questions: list[dict],
    answers: dict[int, list[int]],
    current_q: int,
    custom_answers: dict[int, str] | None = None,
) -> InlineKeyboardMarkup:
    """Клавиатура для одного вопроса с вариантами ответа (множественный выбор + свой вариант)."""
    builder = InlineKeyboardBuilder()
    q = questions[current_q]
    custom_answers = custom_answers or {}
    for opt_idx, opt_text in enumerate(q["options"]):
        selected = opt_idx in (answers.get(current_q) or [])
        mark = "✅ " if selected else ""
        builder.row(InlineKeyboardButton(
            text=f"{mark}{opt_text}",
            callback_data=f"aq_{current_q}_{opt_idx}",
        ))
    custom = (custom_answers.get(current_q) or "").strip()
    custom_label = f" ({custom[:15]}…)" if len(custom) > 15 else f" ({custom})" if custom else ""
    builder.row(InlineKeyboardButton(
        text=f"{'✅ ' if custom else ''}✏️ Свой вариант{custom_label}",
        callback_data=f"aq_custom_{current_q}",
    ))

    is_last = current_q == len(questions) - 1
    nav_text = "✅ Готово — создать промпт" if is_last else "▶ Следующий вопрос"
    builder.row(InlineKeyboardButton(text=nav_text, callback_data="aq_next"))
    builder.row(InlineKeyboardButton(text="⏭ Пропустить все вопросы", callback_data="aq_skip"))
    return builder.as_markup()


def get_techniques_list_keyboard(technique_ids: list[str], names: dict[str, str]) -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    for tid in technique_ids:
        builder.row(InlineKeyboardButton(
            text=f"📖 {names.get(tid, tid)}",
            callback_data=f"tech_explain_{tid}",
        ))
    builder.row(InlineKeyboardButton(text="◀ Назад", callback_data="nav_main"))
    return builder.as_markup()


def get_back_keyboard(callback: str = "nav_main") -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.row(InlineKeyboardButton(text="◀ Назад", callback_data=callback))
    return builder.as_markup()


def get_llm_error_keyboard() -> InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.row(InlineKeyboardButton(text="🔄 Выбрать другую модель", callback_data="settings_llm"))
    return builder.as_markup()
