"""
Бесплатный перевод RU↔EN без вызовов LLM.

Провайдеры (с фолбэком в порядке списка):
  1) MyMemory (https://mymemory.translated.net) — бесплатно, без ключа, ~5000 слов/день анонимно.
  2) Lingva (публичные зеркала Google Translate) — бесплатно, без ключа.

Стратегия:
  - Защищаем code-блоки ``` ... ```, inline `...`, YAML frontmatter (--- ... ---) и HTML/XML-теги
    вида {var}, <tag>, [PLACEHOLDER] от перевода через подстановку плейсхолдеров.
  - Разбиваем оставшийся текст на чанки ≤ 450 символов (MyMemory любит короткие запросы).
  - Кэш в процессе по (hash(text), direction), чтобы повторы не били API.
  - Любой сбой провайдера → следующий в списке. Если все упали — бросаем RuntimeError
    (вызывающий код решает, как откатиться).
"""
from __future__ import annotations

import hashlib
import json as _json
import logging
import re
import threading
import time
from collections import OrderedDict
from typing import Callable, Literal
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

Direction = Literal["ru->en", "en->ru"]

_MAX_CHUNK = 450
_REQUEST_TIMEOUT = 10.0
_CACHE_MAX = 512
_CACHE: "OrderedDict[str, str]" = OrderedDict()
_CACHE_LOCK = threading.Lock()

_LINGVA_HOSTS = [
    "https://lingva.ml",
    "https://translate.plausibility.cloud",
    "https://lingva.garudalinux.org",
]


def detect_direction(text: str) -> tuple[Direction, str]:
    """Определить направление по доле кириллицы. Возвращает (direction, detected_src)."""
    cyr = sum(1 for ch in text if "а" <= ch.lower() <= "я" or ch.lower() in "ёіїєґ")
    lat = sum(1 for ch in text if "a" <= ch.lower() <= "z")
    if cyr > lat:
        return "ru->en", "ru"
    return "en->ru", "en"


_CODE_FENCE_RE = re.compile(r"```[\s\S]*?```", re.MULTILINE)
_INLINE_CODE_RE = re.compile(r"`[^`\n]+`")
_YAML_FM_RE = re.compile(r"^---\n[\s\S]*?\n---\n", re.MULTILINE)
_PLACEHOLDER_RE = re.compile(r"\{\{[^{}]+\}\}|\{[^{}\s][^{}]*\}|\[[A-Z][A-Z0-9_]{1,}\]")
_URL_RE = re.compile(r"https?://\S+")


def _protect_blocks(text: str) -> tuple[str, list[str]]:
    """Вырезать code/YAML/plaсeholders в токены §§0§§, §§1§§ ... — они не переводятся."""
    stash: list[str] = []

    def _sub(match: re.Match[str]) -> str:
        idx = len(stash)
        stash.append(match.group(0))
        return f"§§{idx}§§"

    for rx in (_YAML_FM_RE, _CODE_FENCE_RE, _INLINE_CODE_RE, _PLACEHOLDER_RE, _URL_RE):
        text = rx.sub(_sub, text)
    return text, stash


def _restore_blocks(text: str, stash: list[str]) -> str:
    def _sub(match: re.Match[str]) -> str:
        idx = int(match.group(1))
        if 0 <= idx < len(stash):
            return stash[idx]
        return match.group(0)

    return re.sub(r"§§(\d+)§§", _sub, text)


def _split_chunks(text: str, max_len: int = _MAX_CHUNK) -> list[str]:
    """Делим по параграфам/предложениям, не разрывая посреди слова."""
    if len(text) <= max_len:
        return [text]
    paragraphs = text.split("\n\n")
    chunks: list[str] = []
    for p in paragraphs:
        if len(p) <= max_len:
            chunks.append(p)
            continue
        sentences = re.split(r"(?<=[\.\!\?])\s+", p)
        buf = ""
        for s in sentences:
            if not s:
                continue
            if len(buf) + len(s) + 1 <= max_len:
                buf = f"{buf} {s}".strip()
            else:
                if buf:
                    chunks.append(buf)
                if len(s) > max_len:
                    for i in range(0, len(s), max_len):
                        chunks.append(s[i : i + max_len])
                    buf = ""
                else:
                    buf = s
        if buf:
            chunks.append(buf)
    return [c for c in chunks if c.strip()]


def _cache_key(text: str, direction: Direction) -> str:
    h = hashlib.sha1(text.encode("utf-8")).hexdigest()
    return f"{direction}:{h}"


def _cache_get(text: str, direction: Direction) -> str | None:
    key = _cache_key(text, direction)
    with _CACHE_LOCK:
        value = _CACHE.get(key)
        if value is not None:
            _CACHE.move_to_end(key)
        return value


def _cache_put(text: str, direction: Direction, translated: str) -> None:
    key = _cache_key(text, direction)
    with _CACHE_LOCK:
        _CACHE[key] = translated
        _CACHE.move_to_end(key)
        while len(_CACHE) > _CACHE_MAX:
            _CACHE.popitem(last=False)


def _http_get_json(url: str) -> dict:
    req = Request(url, headers={"User-Agent": "metaprompt-translator/1.0"})
    with urlopen(req, timeout=_REQUEST_TIMEOUT) as resp:  # noqa: S310 — доверяем сервисам перевода
        raw = resp.read()
    return _json.loads(raw.decode("utf-8", errors="replace"))


def _mymemory_translate_chunk(chunk: str, direction: Direction) -> str:
    pair = "ru|en" if direction == "ru->en" else "en|ru"
    qs = urlencode({"q": chunk, "langpair": pair, "de": "metaprompt@local"})
    url = f"https://api.mymemory.translated.net/get?{qs}"
    try:
        data = _http_get_json(url)
    except (HTTPError, URLError) as e:
        raise RuntimeError(f"MyMemory transport error: {e}") from e
    translated = ((data or {}).get("responseData") or {}).get("translatedText") or ""
    translated = str(translated).strip()
    if not translated:
        raise RuntimeError("MyMemory returned empty translation")
    if translated.upper().startswith("PLEASE SELECT TWO DISTINCT LANGUAGES"):
        raise RuntimeError("MyMemory rejected language pair")
    if "MYMEMORY WARNING" in translated.upper():
        raise RuntimeError("MyMemory quota warning")
    return translated


def _lingva_translate_chunk(chunk: str, direction: Direction) -> str:
    src, tgt = ("ru", "en") if direction == "ru->en" else ("en", "ru")
    last_err: Exception | None = None
    for host in _LINGVA_HOSTS:
        try:
            url = f"{host}/api/v1/{src}/{tgt}/{quote(chunk, safe='')}"
            data = _http_get_json(url)
            translated = str(data.get("translation") or "").strip()
            if translated:
                return translated
            last_err = RuntimeError("Lingva returned empty translation")
        except Exception as e:  # noqa: BLE001 — ловим всё, пробуем следующее зеркало
            last_err = e
            continue
    raise RuntimeError(f"All Lingva mirrors failed: {last_err}")


Provider = Callable[[str, Direction], str]
_PROVIDERS: list[tuple[str, Provider]] = [
    ("mymemory", _mymemory_translate_chunk),
    ("lingva", _lingva_translate_chunk),
]


def _translate_single(text: str, direction: Direction) -> tuple[str, str]:
    """Переводит ОДИН чанк, возвращая (translated, provider_used). Кэш учитывается."""
    cached = _cache_get(text, direction)
    if cached is not None:
        return cached, "cache"
    last_err: Exception | None = None
    for name, fn in _PROVIDERS:
        try:
            translated = fn(text, direction)
            _cache_put(text, direction, translated)
            return translated, name
        except Exception as e:  # noqa: BLE001
            last_err = e
            logger.warning("translator: provider %s failed: %s", name, e)
            continue
    raise RuntimeError(f"All translation providers failed: {last_err}")


def translate(text: str, direction: Direction | Literal["auto"] = "auto") -> dict:
    """
    Перевести text. Возвращает dict: {translated, direction, detected_language, provider}.
    Сохраняет code/placeholders/ссылки.
    """
    raw = (text or "").strip()
    if not raw:
        return {"translated": "", "direction": direction or "auto", "detected_language": None, "provider": "noop"}

    if direction == "auto" or not direction:
        direction, detected = detect_direction(raw)
    else:
        detected = "ru" if direction == "ru->en" else "en"

    protected, stash = _protect_blocks(raw)
    chunks = _split_chunks(protected)

    translated_chunks: list[str] = []
    providers_used: list[str] = []
    started = time.perf_counter()
    for chunk in chunks:
        translated, used = _translate_single(chunk, direction)
        translated_chunks.append(translated)
        providers_used.append(used)
    # Восстанавливаем стек плейсхолдеров и двойные переводы строк между параграфами.
    # Детали: если исходный текст делился на \n\n, то итог — тоже \n\n.
    joined = "\n\n".join(translated_chunks) if len(chunks) > 1 else translated_chunks[0] if translated_chunks else ""
    restored = _restore_blocks(joined, stash)

    provider_label = ",".join(sorted(set(providers_used))) or "unknown"
    logger.info(
        "translator: ok direction=%s chunks=%d providers=%s latency_ms=%d",
        direction,
        len(chunks),
        provider_label,
        round((time.perf_counter() - started) * 1000),
    )

    return {
        "translated": restored,
        "direction": direction,
        "detected_language": detected,
        "provider": provider_label,
    }
