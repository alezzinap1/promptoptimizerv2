"""Shared prompt fragments loaded once (Studio + Simple Improve)."""
from __future__ import annotations

from prompts import load_prompt

SHARED_EDITOR_RULES_BLOCK = load_prompt("core/shared_editor_rules.txt")
