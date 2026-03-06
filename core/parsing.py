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
    reasoning, text_without_reasoning = _extract_block(reply, REASONING_OPEN, REASONING_CLOSE)
    prompt_block, text_without_prompt = _extract_block(text_without_reasoning, PROMPT_OPEN, PROMPT_CLOSE)
    questions_block, _ = _extract_block(reply, QUESTIONS_OPEN, QUESTIONS_CLOSE)

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
