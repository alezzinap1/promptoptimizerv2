"""
Intent graph extraction.

The current MVP does not draw an actual node graph. Instead it produces a
structured list of intent nodes that the UI can render as sections such as
known, missing, inferred, and high-risk gaps.
"""
from __future__ import annotations


def build_intent_graph(spec: dict) -> list[dict]:
    """Build a lightweight intent graph from a PromptSpec."""
    nodes = []
    field_meta = [
        ("goal", "Цель", "high"),
        ("output_format", "Формат вывода", "high"),
        ("constraints", "Ограничения", "medium"),
        ("source_of_truth", "Источник истины", "high"),
        ("success_criteria", "Критерии успеха", "medium"),
        ("workspace_name", "Workspace", "low"),
    ]

    for key, label, criticality in field_meta:
        value = spec.get(key)
        if isinstance(value, list):
            has_value = bool(value)
            display = "; ".join(str(v) for v in value[:4])
        else:
            has_value = bool(value)
            display = str(value) if value else ""
        nodes.append(
            {
                "id": key,
                "label": label,
                "value": display,
                "status": "known" if has_value else "missing",
                "criticality": criticality,
            }
        )
    return nodes
