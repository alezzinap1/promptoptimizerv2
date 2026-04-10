"""
Parsing utilities for LLM response blocks.
Shared by the FastAPI backend (primary) and archived Streamlit UI (`app/`).
"""
from __future__ import annotations

import re

PROMPT_OPEN = "[PROMPT]"
PROMPT_CLOSE = "[/PROMPT]"
QUESTIONS_OPEN = "[QUESTIONS]"
QUESTIONS_CLOSE = "[/QUESTIONS]"
REASONING_OPEN = "[REASONING]"
REASONING_CLOSE = "[/REASONING]"
TITLE_OPEN = "[TITLE]"
TITLE_CLOSE = "[/TITLE]"

# Порядок: сначала более длинные имена не нужны — теги не пересекаются
_PROTOCOL_TAG_NAMES = ("reasoning", "title", "questions", "prompt")


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
    """
    Извлекает содержимое блока и текст без этого блока.

    - Если открывающего тега нет — пустой контент, исходный text.
    - Если закрывающего нет — весь хвост после открывающего (типичный сбой модели).
    - Если оба есть — берём пару по *последнему* close_tag в хвосте, чтобы пережить
      литеральное «[/TAG]» внутри примеров в тексте (реальный закрывающий чаще в конце).
    """
    if not text:
        return "", ""
    if open_tag not in text:
        return "", text
    before, rest = text.split(open_tag, 1)
    if close_tag not in rest:
        return rest.strip(), before.strip()
    close_idx = rest.rfind(close_tag)
    content = rest[:close_idx].strip()
    after = rest[close_idx + len(close_tag) :]
    return content, (before.strip() + "\n" + after.strip()).strip()


def _prompt_has_closing_tag_in_raw(raw: str) -> bool:
    """True если после первого [PROMPT] в ответе есть [/PROMPT] (парный закрывающий тег)."""
    if PROMPT_OPEN not in raw:
        return False
    idx = raw.find(PROMPT_OPEN) + len(PROMPT_OPEN)
    return PROMPT_CLOSE in raw[idx:]


def _trim_misplaced_closes_in_prompt_block(prompt_block: str) -> str:
    """
    Убирает из текста промпта ошибочные границы других блоков (модель закрыла [PROMPT] как [/REASONING]).
    """
    if not prompt_block:
        return prompt_block
    pb = prompt_block
    pb = _trim_before_line_start_marker(pb, REASONING_OPEN)
    pb = _trim_before_line_start_marker(pb, REASONING_CLOSE)
    t = pb.rstrip()
    if t.endswith(REASONING_CLOSE):
        pb = t[: -len(REASONING_CLOSE)].rstrip()
    return pb


def _trim_before_line_start_marker(content: str, marker: str) -> str:
    """
    Отрезает хвост от первого вхождения marker, которое начинается с новой строки
    (соседний протокольный блок). Не трогает marker внутри строки (например в JSON).
    """
    if not content or marker not in content:
        return content
    pos = 0
    while True:
        idx = content.find(marker, pos)
        if idx < 0:
            return content
        if idx == 0 or content[idx - 1] in "\r\n":
            return content[:idx].strip()
        pos = idx + len(marker)


def parse_reply(reply: str) -> dict:
    """Parse LLM response into components: reasoning, optional title, prompt, questions, text."""
    raw = _normalize_protocol_markers(reply or "")

    reasoning, after_reasoning = _extract_block(raw, REASONING_OPEN, REASONING_CLOSE)
    title_block, after_title = _extract_block(after_reasoning, TITLE_OPEN, TITLE_CLOSE)
    prompt_block, _text_without_prompt = _extract_block(after_title, PROMPT_OPEN, PROMPT_CLOSE)
    questions_block, _ = _extract_block(after_title, QUESTIONS_OPEN, QUESTIONS_CLOSE)

    # Запасной путь: после вырезания [REASONING] пара [PROMPT] могла не извлечься
    # (например теги только в полном raw или сбой границы блоков).
    if not (prompt_block and prompt_block.strip()) and PROMPT_OPEN in raw:
        fb, _ = _extract_block(raw, PROMPT_OPEN, PROMPT_CLOSE)
        if fb.strip():
            prompt_block = fb

    if not (questions_block and questions_block.strip()) and QUESTIONS_OPEN in raw:
        qb, _ = _extract_block(raw, QUESTIONS_OPEN, QUESTIONS_CLOSE)
        if qb.strip():
            questions_block = qb

    # Без [/PROMPT] весь хвост часто включает [QUESTIONS]… — оставляем только текст промпта.
    if prompt_block and prompt_block.strip():
        prompt_block = _trim_before_line_start_marker(prompt_block, QUESTIONS_OPEN)

    if prompt_block and prompt_block.strip():
        pb_before_misplace = prompt_block
        prompt_block = _trim_misplaced_closes_in_prompt_block(prompt_block)
        # Незакрытый [PROMPT], но в хвосте ошибочно оказался [/REASONING] — это не готовый промпт.
        if PROMPT_OPEN in raw and not _prompt_has_closing_tag_in_raw(raw):
            if REASONING_CLOSE in pb_before_misplace:
                prompt_block = ""

    title_clean = (title_block or "").strip().replace("\n", " ")
    if len(title_clean) > 200:
        title_clean = title_clean[:197] + "…"

    return {
        "reasoning": reasoning,
        "prompt_title": title_clean,
        "prompt_block": prompt_block,
        "questions_raw": questions_block,
        "text": after_reasoning,
        "has_prompt": bool(prompt_block and prompt_block.strip()),
        "has_questions": bool(questions_block and questions_block.strip()),
    }


def _is_option_line(line: str) -> bool:
    return bool(line) and line[0] in "-*•"


def parse_questions(questions_raw: str) -> list[dict] | None:
    """Parse [QUESTIONS] block into structured list of questions with options.

    Поддерживается канонический формат «1. Вопрос» + строки «- вариант», а также
    частый вывод моделей: заголовок вопроса без номера, сразу список «- …».
    """
    if not questions_raw.strip():
        return None

    questions: list[dict] = []
    current_q: dict | None = None
    # Строки текста до первого «N.» или списка вариантов — станут текстом вопроса
    pending_header_parts: list[str] = []

    def flush_current() -> None:
        nonlocal current_q
        if current_q is None:
            return
        if not current_q.get("options"):
            current_q["options"] = ["Пропустить"]
        questions.append(current_q)
        current_q = None

    def start_question_from_pending() -> None:
        nonlocal current_q, pending_header_parts
        if current_q is not None or not pending_header_parts:
            return
        text = " ".join(pending_header_parts).strip()
        pending_header_parts = []
        if text:
            current_q = {"question": text, "options": []}

    for raw_line in questions_raw.split("\n"):
        line = raw_line.strip()
        if not line:
            continue

        m = re.match(r"^\d+\.\s*(.+)$", line)
        if m:
            pending_header_parts.clear()
            flush_current()
            current_q = {"question": m.group(1).strip(), "options": []}
            continue

        if _is_option_line(line):
            opt = line.lstrip("-*•").strip()
            if not opt:
                continue
            if current_q is None:
                start_question_from_pending()
            if current_q is None:
                current_q = {"question": "Уточнение", "options": []}
            current_q["options"].append(opt)
            continue

        # Обычная строка текста (не нумерация, не маркер списка)
        flush_current()
        pending_header_parts.append(line)

    if pending_header_parts and current_q is None:
        start_question_from_pending()

    flush_current()

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
