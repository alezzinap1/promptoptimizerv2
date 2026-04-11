"""
Семантический роутер намерений для студии (fastembed + косинус к центроидам).

- После появления промпта: классы iterate / chat / save_library / …
- До промпта: два класса pre_meta (болтовня / нет задачи) vs pre_task (есть задача на генерацию).

Ленивая загрузка модели при первом запросе. При отсутствии fastembed — intent=None.
"""
from __future__ import annotations

import logging
import math
import os
import threading
from typing import Any

logger = logging.getLogger(__name__)

# Совпадает с типами на фронте (agentFollowUp.ts)
INTENT_IDS = (
    "iterate",
    "chat",
    "save_library",
    "eval_prompt",
    "show_versions",
    "nav_compare",
    "nav_library",
    "nav_skills",
)

# RU + EN короткие реплики на класс (центроид усредняет их)
INTENT_EXAMPLES: dict[str, list[str]] = {
    "iterate": [
        "сделай короче",
        "добавь пример в конец",
        "убери второй пункт",
        "перепиши формальнее",
        "дополни ограничениями",
        "примени совет: добавь ограничения что модель не должна выдумывать факты",
        "apply tip: add constraints",
        "rewrite shorter",
        "add a bullet list",
        "remove the emoji",
    ],
    "chat": [
        "как работает версионирование",
        "что такое библиотека промптов",
        "как ты оцениваешь полноту",
        "объясни интерфейс",
        "what is trial limit",
        "where are settings",
    ],
    "save_library": [
        "сохрани в библиотеку",
        "запомни этот промпт",
        "добавь в библиотеку с тегами",
        "save to library",
        "store this prompt",
    ],
    "eval_prompt": [
        "оцени промпт",
        "насколько полный текст",
        "rate this prompt",
        "check quality",
    ],
    "show_versions": [
        "какие версии есть",
        "покажи историю версий",
        "list versions",
        "previous iterations",
    ],
    "nav_compare": [
        "открой сравнение",
        "перейди к a b тесту",
        "open compare page",
    ],
    "nav_library": [
        "открой библиотеку",
        "покажи мои промпты",
        "go to library",
    ],
    "nav_skills": [
        "открой скиллы",
        "вкладка навыков",
        "skills tab",
    ],
}

# До первого промпта: разговор / мета vs конкретная задача (один эмбеддинг на запрос).
PRE_PROMPT_EXAMPLES: dict[str, list[str]] = {
    "pre_meta": [
        "привет как дела",
        "давай позже вернёмся к задаче",
        "пока не готов описать что нужно",
        "расскажи что ты умеешь",
        "чем можешь помочь в этом приложении",
        "как пользоваться студией промптов",
        "привет давай сделаем скилл",
        "hi lets make a skill later",
        "hello can we chat first",
        "что такое версии в интерфейсе",
        "как работает библиотека промптов",
        "я пока думаю над формулировкой",
        "не знаю с чего начать",
        "мне нужно время чтобы сформулировать задачу",
        "просто здороваюсь",
        "какой у тебя сейчас режим работы",
    ],
    "pre_task": [
        "напиши промпт для суммаризации статей на русском языке",
        "сгенерируй системный промпт для классификации обращений в три категории",
        "нужен промпт для Midjourney киберпанк город ночь неон",
        "скилл ты senior python разработчик отвечай кратко с примерами кода",
        "создай скилл для финансового аналитика с таблицами по запросу",
        "улучши промпт добавь few-shot примеры в конец",
        "опиши инструкцию для модели отвечать только валидным json",
        "задача разбери тикет поддержки и предложи решение в двух абзацах",
        "prompt for sql query generation from natural language",
        "need a skill that rejects unsafe user requests",
        "сформулируй промпт для извлечения сущностей из текста",
        "нужна инструкция для ассистента по работе с API",
    ],
}

_lock = threading.Lock()
_model: Any = None
_centroids: dict[str, list[float]] | None = None
_pre_centroids: dict[str, list[float]] | None = None
_embed_dim: int = 0


def _l2_normalize(vec: list[float]) -> list[float]:
    s = math.sqrt(sum(x * x for x in vec))
    if s < 1e-9:
        return vec
    return [x / s for x in vec]


def _mean_vec(vectors: list[list[float]]) -> list[float]:
    if not vectors:
        return []
    dim = len(vectors[0])
    acc = [0.0] * dim
    for v in vectors:
        for i, x in enumerate(v):
            acc[i] += x
    n = float(len(vectors))
    return [x / n for x in acc]


def _cosine(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        return 0.0
    return sum(x * y for x, y in zip(a, b))


def _ensure_model() -> bool:
    global _model, _centroids, _pre_centroids, _embed_dim
    if _centroids is not None:
        return True
    if os.getenv("SEMANTIC_AGENT_ROUTER", "1").strip().lower() in ("0", "false", "no", "off"):
        return False
    with _lock:
        if _centroids is not None:
            return True
        try:
            from fastembed import TextEmbedding  # type: ignore[import-untyped]
        except ImportError:
            logger.warning("fastembed not installed; semantic agent router disabled")
            return False
        try:
            # ~120 MB, multilingual, быстрый CPU inference
            model_name = os.getenv(
                "SEMANTIC_AGENT_MODEL",
                "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
            )
            _model = TextEmbedding(model_name=model_name)
        except Exception as e:
            logger.warning("semantic router model init failed: %s", e)
            return False

        centroids: dict[str, list[float]] = {}
        for intent, phrases in INTENT_EXAMPLES.items():
            vecs: list[list[float]] = []
            for emb in _model.embed(phrases):
                vecs.append(list(emb))
            if not vecs:
                continue
            _embed_dim = len(vecs[0])
            centroids[intent] = _l2_normalize(_mean_vec(vecs))
        _centroids = centroids

        pre_c: dict[str, list[float]] = {}
        for intent, phrases in PRE_PROMPT_EXAMPLES.items():
            p_vecs: list[list[float]] = []
            for emb in _model.embed(phrases):
                p_vecs.append(list(emb))
            if p_vecs:
                pre_c[intent] = _l2_normalize(_mean_vec(p_vecs))
        _pre_centroids = pre_c if len(pre_c) >= 2 else {}

        logger.info(
            "semantic agent router ready: %d follow-up intents, %d pre-prompt intents, dim=%d",
            len(_centroids),
            len(_pre_centroids),
            _embed_dim,
        )
        return True


def route_intent(text: str, *, has_prompt: bool = True) -> dict[str, Any]:
    """
    Возвращает { intent, confidence, margin, backend }.
    intent — один из INTENT_IDS или None если роутер недоступен / пустой ввод.
    """
    t = (text or "").strip()
    if not t or not has_prompt:
        return {"intent": None, "confidence": 0.0, "margin": 0.0, "backend": "skip"}

    if not _ensure_model() or not _centroids:
        return {"intent": None, "confidence": 0.0, "margin": 0.0, "backend": "unavailable"}

    try:
        q_list = list(_model.embed([t]))
        if not q_list:
            return {"intent": None, "confidence": 0.0, "margin": 0.0, "backend": "error"}
        q = _l2_normalize(list(q_list[0]))
    except Exception as e:
        logger.warning("semantic embed failed: %s", e)
        return {"intent": None, "confidence": 0.0, "margin": 0.0, "backend": "error"}

    scores: list[tuple[str, float]] = []
    for intent, c in _centroids.items():
        scores.append((intent, _cosine(q, c)))
    scores.sort(key=lambda x: -x[1])
    best_intent, best = scores[0]
    second = scores[1][1] if len(scores) > 1 else 0.0
    margin = best - second

    return {
        "intent": best_intent,
        "confidence": round(float(best), 4),
        "margin": round(float(margin), 4),
        "backend": "semantic",
    }


def route_pre_prompt_intent(text: str) -> dict[str, Any]:
    """
    До первого промпта: pre_meta | pre_task или intent=None если роутер недоступен.
    Один вызов embed на текст.
    """
    t = (text or "").strip()
    if not t:
        return {"intent": None, "confidence": 0.0, "margin": 0.0, "backend": "skip"}

    if not _ensure_model() or not _pre_centroids or len(_pre_centroids) < 2:
        return {"intent": None, "confidence": 0.0, "margin": 0.0, "backend": "unavailable"}

    try:
        q_list = list(_model.embed([t]))
        if not q_list:
            return {"intent": None, "confidence": 0.0, "margin": 0.0, "backend": "error"}
        q = _l2_normalize(list(q_list[0]))
    except Exception as e:
        logger.warning("pre-prompt semantic embed failed: %s", e)
        return {"intent": None, "confidence": 0.0, "margin": 0.0, "backend": "error"}

    scores: list[tuple[str, float]] = []
    for intent, c in _pre_centroids.items():
        scores.append((intent, _cosine(q, c)))
    scores.sort(key=lambda x: -x[1])
    best_intent, best = scores[0]
    second = scores[1][1] if len(scores) > 1 else 0.0
    margin = best - second

    return {
        "intent": best_intent,
        "confidence": round(float(best), 4),
        "margin": round(float(margin), 4),
        "backend": "semantic",
    }
