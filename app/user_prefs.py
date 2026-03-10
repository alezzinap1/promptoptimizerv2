"""
Persistent user preferences (theme, font) stored in a JSON file.
Fixes Streamlit's widget key deletion when navigating between pages.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PREFS_PATH = ROOT / "data" / "user_prefs.json"

DEFAULT_THEME = "slate"
DEFAULT_FONT = "jetbrains"


def load_prefs() -> dict[str, str]:
    """Load theme and font from file. Returns defaults if file missing or invalid."""
    try:
        if PREFS_PATH.exists():
            data = json.loads(PREFS_PATH.read_text(encoding="utf-8"))
            return {
                "theme": data.get("theme", DEFAULT_THEME),
                "font": data.get("font", DEFAULT_FONT),
            }
    except (json.JSONDecodeError, OSError):
        pass
    return {"theme": DEFAULT_THEME, "font": DEFAULT_FONT}


def save_prefs(theme: str, font: str) -> None:
    """Save theme and font to file."""
    PREFS_PATH.parent.mkdir(parents=True, exist_ok=True)
    PREFS_PATH.write_text(
        json.dumps({"theme": theme, "font": font}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
