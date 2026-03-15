"""
Workspace helpers for the Prompt IDE flow.

A workspace is a reusable project context with defaults such as glossary,
style rules, reference snippets, and preferred models. The helpers in this
module keep workspace configs normalized so UI and core logic can rely on a
stable shape.
"""
from __future__ import annotations


DEFAULT_WORKSPACE_CONFIG: dict = {
    "glossary": [],
    "style_rules": [],
    "default_constraints": [],
    "reference_snippets": [],
    "preferred_target_model": "unknown",
    "output_preferences": {},
}


def normalize_workspace(workspace: dict | None) -> dict:
    """Return a workspace dict with a predictable config structure."""
    base = {"id": None, "name": "Без workspace", "description": "", "config": {}}
    if not workspace:
        workspace = {}

    merged = {**base, **workspace}
    config = dict(DEFAULT_WORKSPACE_CONFIG)
    config.update((workspace.get("config") or {}))

    # Normalize list-like fields so the UI can render them safely.
    for key in ("glossary", "style_rules", "default_constraints", "reference_snippets"):
        value = config.get(key) or []
        if isinstance(value, str):
            value = [line.strip() for line in value.splitlines() if line.strip()]
        config[key] = list(value)

    merged["config"] = config
    return merged


def build_workspace_context(workspace: dict | None) -> str:
    """Convert workspace defaults into a compact text block for generation."""
    ws = normalize_workspace(workspace)
    cfg = ws["config"]
    lines: list[str] = []

    if ws.get("name") and ws["name"] != "Без workspace":
        lines.append(f"WORKSPACE: {ws['name']}")
    if ws.get("description"):
        lines.append(f"Описание: {ws['description']}")
    if cfg.get("glossary"):
        lines.append("Глоссарий: " + "; ".join(cfg["glossary"][:8]))
    if cfg.get("style_rules"):
        lines.append("Style rules: " + "; ".join(cfg["style_rules"][:8]))
    if cfg.get("default_constraints"):
        lines.append("Default constraints: " + "; ".join(cfg["default_constraints"][:8]))
    if cfg.get("reference_snippets"):
        lines.append("Reference snippets:\n- " + "\n- ".join(cfg["reference_snippets"][:4]))

    return "\n".join(lines).strip()
