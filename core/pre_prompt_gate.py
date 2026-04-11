"""
Дешёвые правила до семантического пре-роутинга: отсечь явный small-talk и явную задачу без эмбеддинга.
Зеркалит идею frontend/src/lib/conversationalGate.ts, без дублирования TASK-маркеров 1:1.
"""
from __future__ import annotations

import re

# Если есть такие подстроки — не считаем реплику «чистым» small-talk (нужен семантический разбор или задача).
_TASK_INTENT_MARKERS = (
    "промпт",
    "prompt",
    "задач",
    "нужен ",
    "нужна ",
    "нужно ",
    "напиши",
    "сгенер",
    "улучши",
    "сделай",
    "сделайте",
    "описани",
    "для модел",
    "json",
    "csv",
    "sql",
    "regex",
    "код ",
    "функци",
    "react",
    "docker",
    "инструкци",
    "системн",
    "few-shot",
    "chain of thought",
    "добавь",
    "дополн",
    "измени",
    "фото",
    "картинк",
    "изображен",
    "midjourney",
    "скилл",
    "навык",
    "skill",
    "создай",
    "сгенерир",
    "составь",
    "оформи",
)

_MINIMAL_RE = re.compile(r"^(ок|окей|okay|да|нет|спасибо|thanks|thx|понял|понятно|ладно|хорошо|ага|угу)\.?$", re.I)

_CHAT_OPENERS = (
    re.compile(r"^как дела", re.I),
    re.compile(r"^как ты\??$", re.I),
    re.compile(r"^что ты умеешь", re.I),
    re.compile(r"^чем можешь помочь", re.I),
    re.compile(r"^кто ты", re.I),
    re.compile(r"^ты кто", re.I),
    re.compile(r"^спасибо", re.I),
    re.compile(r"^благодарю", re.I),
    re.compile(r"^пожалуйста$", re.I),
    re.compile(r"^приветствую", re.I),
    re.compile(r"^пока\b", re.I),
    re.compile(r"^до свидан", re.I),
    re.compile(r"^здравствуйте?$", re.I),
)


def _starts_with_greeting(t: str) -> bool:
    s = t.strip().lower()
    if not s:
        return False
    if re.match(r"^(привет|здравствуй|здравствуйте|хай|салют|дратути|hi|hello|hey|yo)([!?.…,\s]|$)", s, re.I):
        return True
    if re.match(r"^(добрый|доброе)\s+(день|вечер|утро)([!?.…,\s]|$)", s, re.I):
        return True
    return False


def _has_task_marker(text: str) -> bool:
    low = text.lower()
    return any(m in low for m in _TASK_INTENT_MARKERS)


def pre_prompt_rules_meta_chat(text: str) -> bool:
    """
    True — ответить в чате без /generate (жёсткий zero-cost путь).
    Не срабатывает, если есть маркеры задачи — их разруливает семантика.
    """
    t = re.sub(r"[\s\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]+", " ", (text or "").strip())
    if not t:
        return True
    if _has_task_marker(t):
        return False
    if len(t) > 240:
        return False
    if _MINIMAL_RE.match(t):
        return True
    if _starts_with_greeting(t):
        words = t.split()
        if len(words) <= 12:
            return True
    for cre in _CHAT_OPENERS:
        if cre.search(t):
            return True
    words = t.split()
    if len(words) <= 2 and len(t) <= 32 and not re.search(r"\d{2,}", t):
        return True
    return False


def pre_prompt_rules_force_task(text: str) -> bool:
    """True — явно достаточно контекста для генерации; эмбеддинг не нужен."""
    t = (text or "").strip()
    if not t:
        return False
    if "```" in t or "``" in t:
        return True
    words = t.split()
    if len(words) >= 22:
        return True
    if len(t) >= 320:
        return True
    return False


def substantive_skill_request(text: str) -> bool:
    """
    Узкий детект «реально просят оформить скилл», без срабатывания на одно слово «скилл» в болтовне.
    """
    raw = (text or "").strip()
    if not raw:
        return False
    low = raw.lower()
    if not re.search(r"скилл|skill|навык", low, re.I):
        return False
    if len(raw.split()) >= 12:
        return True
    return bool(
        re.search(
            r"(создай|сгенерир|составь|напиши|оформи|нужен\s+скилл|need\s+a\s+skill).{0,80}(скилл|skill|навык)|"
            r"(скилл|skill|навык).{0,60}(для|чтобы|чтоб|:|\n|—)",
            raw,
            re.I | re.DOTALL,
        )
    )