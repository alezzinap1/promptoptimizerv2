"""
Короткий «живой» ответ в чате студии до запуска генерации промпта.
Отдельно от цепочки /generate: только контекст продукта + последние реплики.
"""
from __future__ import annotations

import logging
import re

from services.llm_client import LLMClient

logger = logging.getLogger(__name__)

_STUDIO_CHAT_SYSTEM = """Ты — собеседник в чате студии MetaPrompt (веб-приложение для prompt engineering).

Что это: пользователь слева в чате формулирует задачи; справа приложение собирает готовый промпт для другой языковой модели. Есть вкладки: текст, фото, скилл. Внизу выбирают модель генерации и целевую модель.

Твоя роль сейчас: обычный диалог. Генерацию промпта ты не запускаешь и не имитируешь — только отвечаешь человеку.

Правила ответа:
- Язык — как у пользователя.
- Не обещай и не намекай, что ты «сейчас создаёшь/сгенерируешь/соберёшь промпт» или что приложение уже начало генерацию — это делает отдельный шаг продукта после явного запуска. Не пиши вроде «сейчас сгенерируем», «уже генерирую промпт», «сейчас соберём текст справа».
- 2–4 коротких предложения, по делу, дружелюбно. Без канцелярита и без фраз вроде «определил намерение», «система», «генерацию не запускаю», «я не буду запускать».
- Если просят совет, чем тебя «протестировать» или какой промпт сделать — предложи 1–2 конкретные идеи задачи (одна строка каждая), почему это хороший тест.
- Не оборачивай ответ в ```. Можно очень лёгкий markdown (например **жирный** для одного акцента), но лучше без разметки.
- Не выдумывай возможности продукта, которых нет (API-ключи, платежи и т.д. — не обещай)."""


def _history_block(history: list[dict[str, str]] | None) -> str:
    lines: list[str] = []
    for h in (history or [])[-8:]:
        role = (h.get("role") or "user").strip()
        content = (h.get("content") or "").strip()
        if not content:
            continue
        content = content[:1200]
        lines.append(f"{role}: {content}")
    return "\n".join(lines) if lines else "(начало диалога)"


def strip_agent_meta_phrases(text: str) -> str:
    """Убрать служебные формулировки из ответа ассистента (роутер / классификатор)."""
    t = (text or "").strip()
    for pat in (
        r"определил[ао]?\s+намерение\s+как\s+диалог[^\n.]*[.\n]",
        r"генераци[юя]\s+пока\s+не\s+запускаю[^\n.]*[.\n]",
        r"я\s+не\s+буду\s+запускать[^\n.]*[.\n]",
        r"семантическ\w*\s+разбор[^\n.]*[.\n]?",
        r"лёгк\w*\s+семантическ[^\n.]*[.\n]?",
        # Обещания генерации при ветке chat (вводят в заблуждение)
        r"[^.!?\n]*?(?:сейчас\s+сгенериру|сейчас\s+собер(?:ём|ем)|уже\s+генериру|сгенерируем\s+промпт|сгенерирую\s+промпт)[^.!?\n]*[.!?]\s*",
        r"[^.!?\n]*?(?:will\s+generate\s+(?:the\s+)?prompt|generating\s+(?:the\s+)?prompt\s+now)[^.!?\n]*[.!?]\s*",
    ):
        t = re.sub(pat, "", t, flags=re.I)
    t = re.sub(r"\s{2,}", " ", t).strip()
    return t


def light_studio_chat_reply(
    client: LLMClient,
    *,
    user_text: str,
    prompt_type: str,
    history: list[dict[str, str]] | None,
    provider: str,
    max_tokens: int = 380,
) -> str:
    tab = (prompt_type or "text").strip().lower()
    if tab not in ("text", "image", "skill"):
        tab = "text"
    hist = _history_block(history)
    user_payload = (
        f"Активная вкладка студии: {tab}\n\n"
        f"Последние реплики:\n{hist}\n\n"
        f"Сообщение пользователя:\n{user_text.strip()}"
    )
    try:
        raw = client.generate(
            _STUDIO_CHAT_SYSTEM,
            user_payload,
            provider=provider,
            temperature=0.55,
            max_tokens=max_tokens,
        )
    except Exception as e:
        logger.warning("light_studio_chat_reply generate failed: %s", e)
        return ""
    out = strip_agent_meta_phrases(raw)
    return out.strip()
