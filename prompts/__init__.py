"""Загрузка текстов промптов из файлов для ручного редактирования."""
from __future__ import annotations

from pathlib import Path

_ROOT = Path(__file__).resolve().parent


def load_prompt(relative_path: str) -> str:
    """Читает UTF-8 файл относительно каталога prompts/."""
    path = _ROOT / relative_path.replace("\\", "/")
    return path.read_text(encoding="utf-8").strip()
