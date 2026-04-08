"""
Prompt specification builder.

This module converts raw user intent into a structured prompt spec that can
later power an IDE-like workflow: intent mapping, evidence tracking, debugging,
and final prompt compilation.
"""
from __future__ import annotations

import re

from .workspace_profile import normalize_workspace


OUTPUT_FORMAT_OPTIONS = {"json", "xml", "yaml", "markdown", "table", "list"}


def infer_output_format(text: str) -> str | None:
    """Infer the requested output format from raw text."""
    lower = text.lower()
    if re.search(r"\bjson\b|в формате json|строго json|только json", lower):
        return "json"
    if re.search(r"\bxml\b|xml-тег", lower):
        return "xml"
    if re.search(r"\byaml\b|в формате yaml", lower):
        return "yaml"
    if re.search(r"\bmarkdown\b|md формат", lower):
        return "markdown"
    if re.search(r"таблиц|табличн", lower):
        return "table"
    if re.search(r"списк|bullet|list\b|списком", lower):
        return "list"
    return None


def _normalize_lines(value: str | list[str] | None) -> list[str]:
    """Normalize multiline text or list input into a clean list of strings."""
    if not value:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [line.strip() for line in str(value).splitlines() if line.strip()]


def extract_constraints(text: str, workspace: dict | None = None) -> list[str]:
    """Extract explicit and workspace-level constraints."""
    constraints: list[str] = []
    patterns = [
        "не ", "без ", "только ", "обязательно", "избегай", "никогда",
        "must", "must not", "avoid", "only", "without",
    ]
    for sentence in re.split(r"(?<=[\.\!\?\n])", text):
        stripped = sentence.strip()
        if stripped and any(signal in stripped.lower() for signal in patterns):
            constraints.append(stripped)

    ws = normalize_workspace(workspace)
    constraints.extend(ws["config"].get("default_constraints") or [])
    return constraints[:8]


def infer_source_of_truth(text: str, workspace: dict | None = None) -> list[str]:
    """Infer what material the model should rely on when generating the prompt."""
    lower = text.lower()
    sources: list[str] = []
    patterns = {
        "user_provided_report": r"отч[её]т|report|финансов",
        "user_provided_document": r"документ|doc|pdf|текст|статья|резюме",
        "user_provided_code": r"код|python|script|api|function|class|sql",
        "user_provided_data": r"данн|dataset|csv|таблиц|json",
        "user_provided_examples": r"пример|example|образец|sample",
    }
    for source_name, pattern in patterns.items():
        if re.search(pattern, lower):
            sources.append(source_name)

    ws = normalize_workspace(workspace)
    if ws["config"].get("reference_snippets"):
        sources.append("workspace_reference_snippets")
    return sources[:5]


def infer_success_criteria(text: str, output_format: str | None) -> list[str]:
    """Infer explicit success criteria from the user request."""
    lower = text.lower()
    criteria: list[str] = []
    if output_format:
        criteria.append(f"Ответ должен быть в формате {output_format}")
    if re.search(r"без галлюцина|не придумывай|не додумывай|только факты", lower):
        criteria.append("Не додумывать факты")
    if re.search(r"кратк|лаконич|коротк", lower):
        criteria.append("Ответ должен быть компактным")
    if re.search(r"подробн|детальн|развернут", lower):
        criteria.append("Ответ должен быть подробным")
    if re.search(r"пошагов|по шагам|step by step", lower):
        criteria.append("Структура ответа должна быть пошаговой")
    if re.search(r"на русском|по-русски|русском языке", lower):
        criteria.append("Ответ должен быть на русском языке")
    return criteria[:6]


def build_prompt_spec(
    raw_input: str,
    classification: dict,
    target_model: str = "unknown",
    workspace: dict | None = None,
    previous_prompt: str | None = None,
    overrides: dict | None = None,
) -> dict:
    """Build a structured prompt specification from the current request."""
    ws = normalize_workspace(workspace)
    overrides = overrides or {}
    output_format = overrides.get("output_format") or infer_output_format(raw_input)
    if output_format and output_format not in OUTPUT_FORMAT_OPTIONS:
        output_format = infer_output_format(str(output_format))
    goal = raw_input.strip().split("\n", 1)[0][:220]
    source_of_truth = _normalize_lines(overrides.get("source_of_truth")) or infer_source_of_truth(raw_input, ws)
    success_criteria = _normalize_lines(overrides.get("success_criteria")) or infer_success_criteria(raw_input, output_format)
    constraints = _normalize_lines(overrides.get("constraints")) or extract_constraints(raw_input, ws)
    audience = overrides.get("audience")

    return {
        "goal": goal,
        "task_types": classification.get("task_types", []),
        "complexity": classification.get("complexity", "medium"),
        "target_model": target_model,
        "workspace_id": ws.get("id"),
        "workspace_name": ws.get("name"),
        "audience": audience.strip() if isinstance(audience, str) and audience.strip() else None,
        "input_description": raw_input.strip(),
        "output_format": output_format,
        "constraints": constraints,
        "success_criteria": success_criteria,
        "source_of_truth": source_of_truth,
        "examples": [],
        "tools": [],
        "previous_prompt": previous_prompt,
        "workspace_context": ws["config"],
    }


def build_generation_brief(spec: dict) -> str:
    """Compile the structured prompt spec into a compact generation brief.

    Не дублируем «цель» (первая строка) отдельным пунктом: полный текст задачи
    всегда идёт в «ИСХОДНЫЙ ЗАПРОС ПОЛЬЗОВАТЕЛЯ» — отдельная строка «Цель» давала
    тот же смысл и раздувала user-токены без новой информации.
    """
    parts = ["СТРУКТУРИРОВАННАЯ СПЕЦИФИКАЦИЯ ЗАДАЧИ:"]
    if spec.get("task_types"):
        parts.append(f"- Типы задач: {', '.join(spec['task_types'])}")
    if spec.get("complexity"):
        parts.append(f"- Сложность: {spec['complexity']}")
    if spec.get("output_format"):
        parts.append(f"- Формат вывода: {spec['output_format']}")
    if spec.get("audience"):
        parts.append(f"- Аудитория: {spec['audience']}")
    if spec.get("constraints"):
        parts.append("- Ограничения: " + "; ".join(spec["constraints"]))
    if spec.get("success_criteria"):
        parts.append("- Критерии успеха: " + "; ".join(spec["success_criteria"]))
    if spec.get("source_of_truth"):
        parts.append("- Источник истины: " + "; ".join(spec["source_of_truth"]))
    if spec.get("workspace_name") and spec["workspace_name"] != "Без workspace":
        parts.append(f"- Workspace: {spec['workspace_name']}")
    parts.append("\nИСХОДНЫЙ ЗАПРОС ПОЛЬЗОВАТЕЛЯ:")
    parts.append(spec.get("input_description", ""))
    return "\n".join(parts).strip()
