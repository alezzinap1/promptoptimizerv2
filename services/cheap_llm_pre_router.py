"""
Дешёвый LLM-классификатор намерения до первого промпта (гибрид с правилами + embeddings).
См. бриф: intent generate_skill | generate_prompt | clarify | chat.
"""
from __future__ import annotations

import logging
from typing import Any

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


def _history_block(history_last_3: list[dict[str, str]] | None) -> str:
    if not history_last_3:
        return "(нет)"
    lines: list[str] = []
    for h in history_last_3[-3:]:
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
    history_last_3: list[dict[str, str]] | None,
    provider: str,
    expert_level: str | None = None,
) -> dict[str, Any]:
    """
    Возвращает:
      intent: generate_skill | generate_prompt | clarify | chat
      confidence: float
      reply: str (для clarify/chat)
      reason: str
    """
    tab = (prompt_type or "text").strip().lower()
    if tab not in ("text", "image", "skill"):
        tab = "text"
    hist = _history_block(history_last_3)
    system = """Ты — пре-роутер чата Студии Агента. Отвечай ТОЛЬКО одним JSON-объектом без markdown.

Поля JSON (все обязательны):
- "intent": одно из "generate_skill" | "generate_prompt" | "clarify" | "chat"
- "confidence": число от 0 до 1 (насколько уверен в классификации)
- "reply": строка — только если intent "clarify" или "chat": короткий ответ пользователю на русском или языке запроса; иначе пустая строка ""
- "reason": кратко на русском: почему такой intent

Смысл intent:
- generate_skill — пользователь хочет оформить навык/инструкцию для ИИ-ассистента (скилл), даже если описание короткое но осмысленное.
- generate_prompt — нужен обычный промпт под задачу (текст, картинка по описанию и т.д.), не обязательно «скилл».
- clarify — нужен ровно один уточняющий вопрос; в "reply" сформулируй его.
- chat — приветствие, small-talk, мета, нет задачи.

Правило для вкладки skill: если пользователь описывает поведение, роль или инструкцию для ассистента — почти всегда generate_skill (confidence высокая).

Правило: не относись к коротким но содержательным описаниям скилла как к «разговору без задачи»."""
    user = f"""Вкладка студии: {tab}
Последние реплики (контекст):
{hist}

Текущее сообщение пользователя:
\"\"\"{text}\"\"\"

Верни JSON с полями intent, confidence, reply, reason."""

    data = client.generate_json(system, user, provider=provider, max_tokens=450)
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

    reply = str(data.get("reply") or "").strip()
    reason = str(data.get("reason") or "").strip()

    # Порог по уровню: при generate_* с низкой уверенностью — уточнение
    thr = confidence_threshold_for_level(expert_level)
    if intent_raw in ("generate_skill", "generate_prompt") and conf < thr:
        intent_raw = "clarify"
        if not reply:
            reply = "Нужно чуть больше деталей, чтобы собрать промпт. Опишите цель и формат ответа одним-двумя предложениями."
        reason = (reason + " " if reason else "") + f"confidence {conf:.2f} < threshold {thr:.2f}"

    return {
        "intent": intent_raw,
        "confidence": conf,
        "reply": reply,
        "reason": reason,
    }
