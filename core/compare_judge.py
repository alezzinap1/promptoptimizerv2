"""
LLM-as-judge для сравнения двух сгенерированных промптов (A/B).
"""
from __future__ import annotations

import json
import logging
import re

logger = logging.getLogger(__name__)

COMPARE_JUDGE_SYSTEM = """Ты — беспристрастный судья качества промптов для LLM. Тебе даны:
- формулировка исходной задачи пользователя;
- два варианта промпта (A и B), сгенерированные разными наборами техник.

Твоя задача — сравнить **только** эти два текста относительно задачи. Не выдумывай факты, которых нет в задаче или в промптах.

Ответь **только** JSON без markdown-оболочки:
{"winner":"a"|"b"|"tie","reasoning":"2-4 предложения по-русски","scores":{"a":0-10,"b":0-10}}

Критерии (учитывай все):
- соответствие цели задачи и явным ограничениям из формулировки;
- ясность и выполнимость инструкций для целевой модели;
- отсутствие лишней воды и противоречий;
- не наказывай за разумную разницу стиля, если оба адекватны — тогда "tie" или близкие scores.

Если один промпт явно добавляет выдуманные факты по сравнению с задачей — другой предпочтительнее."""


def _parse_judge_json(text: str) -> dict | None:
    raw = (text or "").strip()
    if not raw:
        return None
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw, re.IGNORECASE)
    if fence:
        raw = fence.group(1).strip()
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", raw)
        if m:
            try:
                data = json.loads(m.group(0))
                return data if isinstance(data, dict) else None
            except json.JSONDecodeError:
                pass
    return None


def run_compare_judge(
    llm,
    judge_model: str,
    task_input: str,
    prompt_a: str,
    prompt_b: str,
    temperature: float = 0.2,
) -> dict:
    """
    judge_model — short key или openrouter id.
    Возвращает { winner, reasoning, scores, raw_error? }
    """
    user = (
        "ЗАДАЧА ПОЛЬЗОВАТЕЛЯ:\n---\n"
        f"{task_input.strip()[:20000]}\n---\n\n"
        "ПРОМПТ A:\n---\n"
        f"{(prompt_a or '')[:24000]}\n---\n\n"
        "ПРОМПТ B:\n---\n"
        f"{(prompt_b or '')[:24000]}\n---"
    )
    try:
        out = llm.generate(COMPARE_JUDGE_SYSTEM, user, judge_model, temperature=temperature, top_p=0.9)
        parsed = _parse_judge_json(out)
        if not parsed:
            return {"winner": "tie", "reasoning": "Судья вернул неразборчивый ответ.", "scores": None, "parse_error": True}
        w = str(parsed.get("winner") or "tie").lower().strip()
        if w not in ("a", "b", "tie"):
            w = "tie"
        reasoning = str(parsed.get("reasoning") or "").strip() or "Без пояснения."
        scores = parsed.get("scores")
        if not isinstance(scores, dict):
            scores = None
        return {"winner": w, "reasoning": reasoning, "scores": scores, "parse_error": False}
    except Exception as e:
        logger.exception("compare judge failed")
        return {"winner": "tie", "reasoning": f"Ошибка вызова судьи: {e}", "scores": None, "parse_error": True}
