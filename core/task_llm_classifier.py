"""
Опциональная классификация задачи через дешёвый LLM-вызов (JSON).
"""
from __future__ import annotations

import json
import logging
import re

from core.task_classifier import classify_task as classify_task_heuristic

logger = logging.getLogger(__name__)

VALID_TYPES = frozenset({
    "code", "analysis", "creative", "writing", "structured_output", "transformation",
    "instruction", "debugging", "decision_making", "research", "data_analysis", "general",
})

CLASSIFIER_SYSTEM = """Ты — классификатор задач для prompt engineering. По тексту пользователя определи тип(ы) и сложность.

Ответь ТОЛЬКО одним JSON-объектом без markdown и без текста до/после:
{"task_types": ["..."], "complexity": "low"|"medium"|"high", "confidence": 0.0-1.0}

Правила:
- task_types: 1–3 значения из списка: code, analysis, creative, writing, structured_output, transformation, instruction, debugging, decision_making, research, data_analysis, general
- complexity: low | medium | high
- confidence: насколько уверена классификация (0–1)
- Не выдумывай факты вне текста пользователя."""


def _parse_json_object(text: str) -> dict | None:
    text = (text or "").strip()
    if not text:
        return None
    # срезать ```json ... ```
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.IGNORECASE)
    if fence:
        text = fence.group(1).strip()
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", text)
        if m:
            try:
                data = json.loads(m.group(0))
                return data if isinstance(data, dict) else None
            except json.JSONDecodeError:
                pass
    return None


def normalize_llm_classification(raw: dict, user_input: str) -> dict:
    """Привести JSON классификатора к формату classify_task."""
    types = raw.get("task_types") or []
    if not isinstance(types, list):
        types = []
    cleaned: list[str] = []
    for t in types:
        s = str(t).strip().lower().replace(" ", "_")
        if s in VALID_TYPES and s not in cleaned:
            cleaned.append(s)
    if not cleaned:
        cleaned = ["general"]
    complexity = str(raw.get("complexity") or "medium").lower()
    if complexity not in ("low", "medium", "high"):
        complexity = "medium"
    word_count = len(user_input.split())
    has_code = "```" in user_input or bool(re.search(r"\b(def |class |import |fn |const )\b", user_input))
    return {
        "task_types": cleaned[:4],
        "complexity": complexity,
        "word_count": word_count,
        "has_code": has_code,
        "classifier_confidence": float(min(1.0, max(0.0, float(raw.get("confidence", 0.8))))),
        "classification_source": "llm",
    }


def classify_task_with_llm(llm, provider: str, user_input: str, temperature: float = 0.1) -> dict:
    """
    LLM-классификация. При ошибке — fallback на эвристику.
    llm: LLMClient instance
    provider: short name или openrouter id
    """
    text = (user_input or "").strip()
    if not text:
        h = classify_task_heuristic("")
        h["classification_source"] = "heuristic"
        h["classifier_confidence"] = 1.0
        return h
    try:
        user_msg = f"Текст задачи пользователя:\n---\n{text[:12000]}\n---"
        out = llm.generate(CLASSIFIER_SYSTEM, user_msg, provider, temperature=temperature, top_p=0.9)
        parsed = _parse_json_object(out)
        if not parsed:
            raise ValueError("no json")
        norm = normalize_llm_classification(parsed, text)
        return norm
    except Exception as e:
        logger.warning("LLM classifier failed, using heuristic: %s", e)
        h = classify_task_heuristic(text)
        h["classification_source"] = "heuristic"
        h["classifier_confidence"] = 0.5
        return h
