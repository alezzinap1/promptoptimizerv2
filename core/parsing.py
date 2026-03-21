"""
Parsing utilities for LLM response blocks.
Shared between Telegram bot and Streamlit web app.
"""
from __future__ import annotations

import re

PROMPT_OPEN = "[PROMPT]"
PROMPT_CLOSE = "[/PROMPT]"
QUESTIONS_OPEN = "[QUESTIONS]"
QUESTIONS_CLOSE = "[/QUESTIONS]"
REASONING_OPEN = "[REASONING]"
REASONING_CLOSE = "[/REASONING]"

# Порядок: сначала более длинные имена не нужны — теги не пересекаются
_PROTOCOL_TAG_NAMES = ("reasoning", "questions", "prompt")


def _normalize_protocol_markers(text: str) -> str:
    """Приводит варианты вроде [prompt] к каноническому [PROMPT] для парсера."""
    if not text:
        return text
    out = text
    for name in _PROTOCOL_TAG_NAMES:
        upper = name.upper()
        out = re.sub(rf"\[{name}\]", f"[{upper}]", out, flags=re.IGNORECASE)
        out = re.sub(rf"\[/{name}\]", f"[/{upper}]", out, flags=re.IGNORECASE)
    return out


def _extract_block(text: str, open_tag: str, close_tag: str) -> tuple[str, str]:
    """Extract block content. Returns (content, text_without_block)."""
    if open_tag not in text or close_tag not in text:
        return "", text
    before, rest = text.split(open_tag, 1)
    if close_tag not in rest:
        return rest.strip(), before.strip()
    content, after = rest.split(close_tag, 1)
    return content.strip(), (before.strip() + "\n" + after.strip()).strip()


def parse_reply(reply: str) -> dict:
    """Parse LLM response into components: reasoning, prompt, questions, text."""
    raw = _normalize_protocol_markers(reply or "")

    reasoning, text_without_reasoning = _extract_block(raw, REASONING_OPEN, REASONING_CLOSE)
    prompt_block, text_without_prompt = _extract_block(text_without_reasoning, PROMPT_OPEN, PROMPT_CLOSE)
    questions_block, _ = _extract_block(raw, QUESTIONS_OPEN, QUESTIONS_CLOSE)

    # Запасной путь: если после вырезания reasoning пара [PROMPT] не нашлась, но в полном ответе есть
    if not (prompt_block and prompt_block.strip()) and PROMPT_OPEN in raw and PROMPT_CLOSE in raw:
        fb, _ = _extract_block(raw, PROMPT_OPEN, PROMPT_CLOSE)
        if fb.strip():
            prompt_block = fb

    if not (questions_block and questions_block.strip()) and QUESTIONS_OPEN in raw and QUESTIONS_CLOSE in raw:
        qb, _ = _extract_block(raw, QUESTIONS_OPEN, QUESTIONS_CLOSE)
        if qb.strip():
            questions_block = qb

    return {
        "reasoning": reasoning,
        "prompt_block": prompt_block,
        "questions_raw": questions_block,
        "text": text_without_reasoning,
        "has_prompt": bool(prompt_block and prompt_block.strip()),
        "has_questions": bool(questions_block and questions_block.strip()),
    }


def parse_questions(questions_raw: str) -> list[dict] | None:
    """Parse [QUESTIONS] block into structured list of questions with options."""
    if not questions_raw.strip():
        return None

    questions: list[dict] = []
    current_q: dict | None = None

    for line in questions_raw.split("\n"):
        line = line.strip()
        if not line:
            continue
        m = re.match(r"^\d+\.\s*(.+)$", line)
        if m:
            if current_q is not None:
                if not current_q.get("options"):
                    current_q["options"] = ["Пропустить"]
                questions.append(current_q)
            current_q = {"question": m.group(1).strip(), "options": []}
        elif line.startswith(("-", "*", "•")) and current_q is not None:
            opt = line.lstrip("-*•").strip()
            if opt:
                current_q["options"].append(opt)

    if current_q is not None:
        if not current_q.get("options"):
            current_q["options"] = ["Пропустить"]
        questions.append(current_q)

    if not questions:
        return None

    normalized = []
    for q in questions[:5]:
        opts = q["options"][:5]
        if len(opts) < 2:
            opts.append("Пропустить")
        q["options"] = opts
        normalized.append(q)
    return normalized


# Варианты, которые парсер подставляет как заглушку — не считаются полноценными ответами UI.
_SKIP_LIKE_OPTIONS = frozenset(
    {
        "пропустить",
        "skip",
        "n/a",
        "нет",
        "—",
        "-",
        "не знаю",
        "любой",
    }
)


def _option_is_meaningful(text: str) -> bool:
    t = (text or "").strip().lower()
    return bool(t) and t not in _SKIP_LIKE_OPTIONS


def questions_have_weak_options(questions: list[dict]) -> bool:
    """
    True если по каждому вопросу меньше двух осмысленных вариантов (часто только «Пропустить»).
    """
    if not questions:
        return False
    for q in questions:
        opts = q.get("options") or []
        meaningful = [o for o in opts if _option_is_meaningful(str(o))]
        if len(meaningful) < 2:
            return True
    return False


def diagnose_generation_response(parsed: dict, questions: list[dict]) -> dict:
    """
    Сводка для API/UI: сбой формата, флаг вопросов без списка, слабые варианты.
    """
    has_p = bool(parsed.get("has_prompt"))
    has_q_block = bool(parsed.get("has_questions"))
    q_list = questions or []

    return {
        "format_failure": not has_p and not has_q_block,
        "questions_unparsed": has_q_block and len(q_list) == 0,
        "weak_question_options": bool(q_list) and questions_have_weak_options(q_list),
    }
