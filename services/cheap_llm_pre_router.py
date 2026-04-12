"""
Дешёвый LLM-классификатор намерения до первого промпта (гибрид с правилами + embeddings).
Один вызов: intent + готовый reply для chat/clarify (без второго LLM).
См. бриф: intent generate_skill | generate_prompt | clarify | chat.
"""
from __future__ import annotations

import logging
from typing import Any

from services.agent_studio_chat_reply import strip_agent_meta_phrases
from services.llm_client import LLMClient

logger = logging.getLogger(__name__)

# Порог confidence для «сразу генерировать» по уровню эксперта (ниже → clarify).
LEVEL_GENERATE_CONFIDENCE: dict[str, float] = {
    "junior": 0.75,
    "mid": 0.65,
    "senior": 0.50,
    "creative": 0.55,
}


def confidence_threshold_for_level(expert_level: str | None) -> float:
    k = (expert_level or "mid").lower().strip()
    return LEVEL_GENERATE_CONFIDENCE.get(k, 0.65)


def _history_block(chat_history: list[dict[str, str]] | None) -> str:
    if not chat_history:
        return "(нет)"
    lines: list[str] = []
    for h in chat_history[-8:]:
        role = h.get("role") or "user"
        content = (h.get("content") or "").strip()
        if not content:
            continue
        lines.append(f"{role}: {content[:1200]}")
    return "\n".join(lines) if lines else "(нет)"


def cheap_llm_pre_router(
    client: LLMClient,
    *,
    text: str,
    prompt_type: str,
    chat_history: list[dict[str, str]] | None,
    provider: str,
    expert_level: str | None = None,
) -> dict[str, Any]:
    """
    Возвращает:
      intent: generate_skill | generate_prompt | clarify | chat
      confidence: float
      reply: str (для clarify/chat — сразу текст для пользователя)
      reason: str
    """
    tab = (prompt_type or "text").strip().lower()
    if tab not in ("text", "image", "skill"):
        tab = "text"
    hist = _history_block(chat_history)
    system = """Ты — пре-роутер чата Студии Агента (MetaPrompt). Отвечай ТОЛКО одним JSON-объектом без markdown.

Поля JSON (все обязательны):
- "intent": одно из "generate_skill" | "generate_prompt" | "clarify" | "chat"
- "confidence": число от 0 до 1
- "reply": для intent "clarify" или "chat" — готовый ответ пользователю (см. ниже); для generate_* — ""
- "reason": кратко на русском: почему такой intent (внутренняя пометка, не для показа пользователю)

Смысл intent:
- generate_skill — навык/инструкция для ИИ-ассистента.
- generate_prompt — обычный промпт (текст, картинка и т.д.).
- clarify — один уточняющий вопрос в "reply".
- chat — приветствие, болтовня, вопрос как протестировать помощника, без конкретной задачи на промпт.

Контекст для "reply" (chat/clarify): слева чат, справа собирается промпт для другой модели; вкладки текст / фото / скилл. Ты не запускаешь генерацию — только текст ответа человеку.

Требования к "reply" при chat или clarify:
- Язык как у пользователя; 2–4 коротких предложения; по делу.
- Нельзя: «определил намерение», «генерацию не запускаю», «семантический разбор», технические детали пайплайна.
- Если спрашивают пример промпта для проверки — 1–2 конкретные идеи формулировки.

Вкладка skill: содержательное описание поведения/роли — почти всегда generate_skill.
Короткое но осмысленное описание скилла не считай болтовнёй."""
    user = f"""Вкладка студии: {tab}
Последние реплики (контекст):
{hist}

Текущее сообщение пользователя:
\"\"\"{text}\"\"\"

Верни JSON с полями intent, confidence, reply, reason."""

    data = client.generate_json(system, user, provider=provider, max_tokens=560)
    if not data:
        return {
            "intent": "clarify",
            "confidence": 0.0,
            "reply": "",
            "reason": "router_json_empty",
        }

    intent_raw = str(data.get("intent") or "").strip().lower()
    if intent_raw not in ("generate_skill", "generate_prompt", "clarify", "chat"):
        intent_raw = "clarify"

    try:
        conf = float(data.get("confidence"))
    except (TypeError, ValueError):
        conf = 0.5
    conf = max(0.0, min(1.0, conf))

    reply = strip_agent_meta_phrases(str(data.get("reply") or "").strip())
    reason = str(data.get("reason") or "").strip()

    # Порог по уровню: при generate_* с низкой уверенностью — уточнение
    thr = confidence_threshold_for_level(expert_level)
    if intent_raw in ("generate_skill", "generate_prompt") and conf < thr:
        intent_raw = "clarify"
        if not reply:
            reply = "Нужно чуть больше деталей, чтобы собрать промпт. Опишите цель и формат ответа одним-двумя предложениями."
        reason = (reason + " " if reason else "") + f"confidence {conf:.2f} < threshold {thr:.2f}"
        reply = strip_agent_meta_phrases(reply)

    return {
        "intent": intent_raw,
        "confidence": conf,
        "reply": reply,
        "reason": reason,
    }
