"""
Rule-based follow-up routing for Agent Studio (after a prompt exists).
Mirrors frontend/src/lib/agentFollowUp.ts — backend is source of truth for /agent/process.
"""
from __future__ import annotations

import re
from typing import Any

from config.settings import SEMANTIC_ROUTE_MIN_CONFIDENCE, SEMANTIC_ROUTE_MIN_MARGIN

AGENT_PRODUCT_HELP_TEXT = """Кратко про интерфейс:
• **Версии** — каждая генерация в этой сессии сохраняется; переключайте «таблетки» v1, v2… под промптом.
• **Библиотека** — кнопка «В библиотеку» или напишите «сохрани в библиотеку с тегами …».
• **Сравнение** — кнопка «Сравнить» или попросите «открой сравнение».
• **Полнота** — эвристика по структуре текста промпта; это не оценка ответа модели в чате.

Чтобы **изменить текст промпта**, опишите правку явно (например: «убери третий пункт», «добавь пример»)."""


def normalize_agent_user_message(t: str) -> str:
    s = t.replace("\ufeff", "")
    s = re.sub(r"[\u200b-\u200d\ufeff\u2060]", "", s)
    s = re.sub(r"[\s\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]+", " ", s)
    return s.strip()


def looks_like_apply_tip_directive(t: str) -> bool:
    s = normalize_agent_user_message(t)
    low = s.lower()
    if low.startswith("примени совет") or low.startswith("применить совет"):
        return True
    if low.startswith("apply tip"):
        return True
    head = low[:56]
    if re.search(r"примени(ть)?\s+совет", head, re.I):
        return True
    if re.search(r"apply\s+tip", head, re.I):
        return True
    # Home.tsx: «Всё в чат» / «В чат» после LLM-судьи и «Применить всё» по improvement_tips
    if re.match(r"^учти\s+и\s+примени\s+советы\s+по\s+очереди\s*:", low):
        return True
    if re.match(r"^учти\s+по\s+очереди\s+советы\s+судьи\s*:", low):
        return True
    if re.match(r"^учти\s+совет\s+судьи\s*:", low):
        return True
    return False


def looks_like_edit_command(t: str) -> bool:
    s = t.strip()
    if re.match(
        r"^(измени|убери|добавь|замени|перепиши|сократ|удлин|вставь|удали|поправь|улучши|дополни|расширь|сжать|формализуй)\b",
        s,
        re.I,
    ):
        return True
    if re.search(r"\b(сделай\s+(короче|длиннее|проще|строже|формальн)|короче|длиннее|проще)\b", t, re.I):
        return True
    if re.match(r"^(убери|добавь|замени)\s+.+", s, re.I):
        return True
    return False


def looks_like_strong_edit(t: str) -> bool:
    s = normalize_agent_user_message(t)
    if looks_like_apply_tip_directive(s):
        return True
    return looks_like_edit_command(s)


def looks_like_meta_or_product_question(t: str) -> bool:
    low = t.lower()
    trimmed = t.strip()
    if re.match(r"^(а\s+)?(как|что|почему|объясни|расскажи|где|когда|зачем)\b", trimmed, re.I):
        return True
    needles = (
        "версионирован",
        "версии ",
        "версия ",
        "библиотек",
        "интерфейс",
        "как ты ",
        "как вы ",
        "что такое",
        "как работает",
        "как устроен",
        "полноту ",
        "оцениваешь",
        "оцениваете",
        "сколько стоит",
        "trial",
        "лимит",
    )
    return any(n in low for n in needles)


def parse_tags_from_text(t: str) -> list[str]:
    m = re.search(r"тег(?:и|ами)?\s*[:-]?\s*([^\n.?!]+)", t, re.I)
    if not m:
        return []
    parts = re.split(r"[,;]+", m.group(1))
    return [p.strip() for p in parts if p.strip()][:24]


def parse_title_hint(t: str) -> str | None:
    m = re.search(
        r'(?:как|названием|название|заголовок)\s+["«\']([^"»\']+)["»\']|названием\s+([^\n.?!]{2,80})',
        t,
        re.I,
    )
    if not m:
        return None
    raw = (m.group(1) or m.group(2) or "").strip()
    return raw or None


def save_library_data_from_text(text: str) -> dict[str, Any]:
    return {
        "tags": parse_tags_from_text(text),
        "title_hint": parse_title_hint(text),
    }


def classify_agent_follow_up_api_response(text: str, prompt_type: str) -> dict[str, Any]:
    """
    Full /agent/process-shaped response when semantic routing yields no intent.
    Mirrors classifyAgentFollowUp + iterate data shape.
    """
    raw = normalize_agent_user_message(text)
    low = raw.lower()

    if looks_like_apply_tip_directive(raw):
        return {
            "action": "iterate",
            "data": {"feedback": text, "prompt_type": prompt_type},
            "reasoning": "rules: apply_tip_button",
        }

    if re.search(r"сохрани|в\s+библиотек|save\s+to\s+library|добавь\s+в\s+библиотек", raw, re.I):
        extra = save_library_data_from_text(raw)
        return {
            "action": "save_library",
            "data": extra,
            "reasoning": f"rules: save_library tags={extra['tags']!r}",
        }

    if re.search(
        r"оцени\s+(промпт|текст)|eval(uate)?\s+prompt|полноту\s+промпта|качеств(?:о|а)\s+промпта",
        raw,
        re.I,
    ) or (re.search(r"оцени\b", raw, re.I) and "промпт" in low):
        return {"action": "eval_prompt", "data": {}, "reasoning": "rules: eval_prompt"}

    if re.search(r"верси(?:и|я|й|ю)|истори(?:я|и)\s+промпт|что\s+за\s+верси", raw, re.I):
        return {"action": "show_versions", "data": {}, "reasoning": "rules: show_versions"}

    if re.search(r"сравни|сравнение|a\s*/\s*b|ab\s+тест", raw, re.I):
        return {"action": "nav_compare", "data": {}, "reasoning": "rules: nav_compare"}

    if re.search(r"скилл|skill|навык", raw, re.I) and re.search(
        r"открой|покажи|перейди|библиотек", raw, re.I
    ):
        return {"action": "nav_skills", "data": {}, "reasoning": "rules: nav_skills"}

    if re.search(r"(?:открой|покажи|перейди|загляни)\b", raw, re.I) and (
        re.search(r"(?:библиотек|промпт(?:ы|ов))", raw, re.I) or re.search(r"мои\s+промпты", low)
    ):
        qm = re.search(r'по\s+(?:запросу|искомому|тексту)\s+["«\']([^"»\']+)["»\']', raw, re.I)
        search = qm.group(1).strip() if qm else None
        data: dict[str, Any] = {}
        if search:
            data["search"] = search
        return {"action": "nav_library", "data": data, "reasoning": "rules: nav_library"}

    if looks_like_meta_or_product_question(raw) and not looks_like_edit_command(raw):
        return {
            "action": "chat",
            "data": {"message": AGENT_PRODUCT_HELP_TEXT},
            "reasoning": "rules: product_help",
        }

    return {
        "action": "iterate",
        "data": {"feedback": text, "prompt_type": prompt_type},
        "reasoning": "rules: edit_prompt_default",
    }


def semantic_chat_should_be_iterate(intent: str | None, text: str) -> bool:
    """Resolver override: semantic 'chat' + apply-tip shaped text -> iterate."""
    return intent == "chat" and looks_like_apply_tip_directive(text)


def map_semantic_intent_to_follow_up_response(
    intent: str,
    text: str,
    prompt_type: str,
    conf: float,
    margin: float,
) -> dict[str, Any]:
    reason_meta = f"semantic_route: {intent} (conf={conf:.2f}, margin={margin:.2f})"
    if intent == "iterate":
        return {
            "action": "iterate",
            "data": {"feedback": text, "prompt_type": prompt_type},
            "reasoning": reason_meta,
        }
    if intent == "save_library":
        extra = save_library_data_from_text(text)
        return {
            "action": "save_library",
            "data": extra,
            "reasoning": reason_meta,
        }
    if intent == "eval_prompt":
        return {"action": "eval_prompt", "data": {}, "reasoning": reason_meta}
    if intent == "show_versions":
        return {"action": "show_versions", "data": {}, "reasoning": reason_meta}
    if intent == "nav_compare":
        return {"action": "nav_compare", "data": {}, "reasoning": reason_meta}
    if intent == "nav_library":
        data: dict[str, Any] = {}
        qm = re.search(
            r'по\s+(?:запросу|искомому|тексту)\s+["«\']([^"»\']+)["»\']',
            text,
            re.I,
        )
        if qm:
            data["search"] = qm.group(1).strip()
        return {"action": "nav_library", "data": data, "reasoning": reason_meta}
    if intent == "nav_skills":
        return {"action": "nav_skills", "data": {}, "reasoning": reason_meta}
    if intent == "chat":
        return {
            "action": "chat",
            "data": {"message": AGENT_PRODUCT_HELP_TEXT},
            "reasoning": reason_meta,
        }
    if intent.startswith("nav_"):
        return {
            "action": intent,
            "data": {},
            "reasoning": reason_meta,
        }
    return {
        "action": "iterate",
        "data": {"feedback": text, "prompt_type": prompt_type},
        "reasoning": f"semantic_unknown_intent:{intent}",
    }


def resolve_has_prompt_action(text: str, prompt_type: str, route_result: dict[str, Any]) -> dict[str, Any]:
    """
    Full routing when the studio already has a prompt (mirrors agentPlanResolver + semantic).
    `route_result` is the raw output of services.semantic_agent_router.route_intent.
    """
    if looks_like_strong_edit(text):
        return {
            "action": "iterate",
            "data": {"feedback": text, "prompt_type": prompt_type},
            "reasoning": "override_strong_edit",
        }

    intent = route_result.get("intent")
    conf = float(route_result.get("confidence") or 0.0)
    margin = float(route_result.get("margin") or 0.0)
    if intent and (conf < SEMANTIC_ROUTE_MIN_CONFIDENCE or margin < SEMANTIC_ROUTE_MIN_MARGIN):
        intent = None

    if intent and semantic_chat_should_be_iterate(intent, text):
        return {
            "action": "iterate",
            "data": {"feedback": text, "prompt_type": prompt_type},
            "reasoning": f"semantic_chat_overridden_apply_tip conf={conf:.2f} margin={margin:.2f}",
        }

    if intent:
        return map_semantic_intent_to_follow_up_response(
            intent, text, prompt_type, conf, margin
        )

    return classify_agent_follow_up_api_response(text, prompt_type)
