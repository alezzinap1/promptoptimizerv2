"""Короткие советы из текста ответа LLM-судьи (буллеты до строки «Итог»)."""
from __future__ import annotations

import re


def extract_llm_review_hints(review: str, *, max_hints: int = 8) -> list[str]:
    text = (review or "").strip()
    if not text:
        return []
    hints: list[str] = []
    in_fence = False
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        low = line.lower()
        if low.startswith("итог"):
            break
        m = re.match(r"^[-*•]\s+(.+)$", line) or re.match(r"^\d+[.)]\s+(.+)$", line)
        if not m:
            continue
        t = m.group(1).strip()
        t = re.sub(r"\*\*([^*]+)\*\*", r"\1", t)
        t = t.strip()
        if len(t) < 2:
            continue
        if t in hints:
            continue
        hints.append(t[:500])
        if len(hints) >= max_hints:
            break
    return hints
