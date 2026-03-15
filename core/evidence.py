"""
Evidence tracking for prompt specifications (Evidence-Bound Prompting).

Shows provenance of PromptSpec fields: user, workspace, inferred, assumed, missing.
Supports accept/reject for inferred/assumed fields so the user can confirm
or exclude system assumptions before generation.
"""
from __future__ import annotations

SOURCE_USER = "user"
SOURCE_WORKSPACE = "workspace"
SOURCE_INFERRED = "inferred"
SOURCE_ASSUMED = "assumed"
SOURCE_MISSING = "missing"


def build_evidence_map(spec: dict, raw_input: str, workspace: dict | None = None) -> dict[str, dict]:
    """Return evidence metadata for the main PromptSpec fields."""
    lower = raw_input.lower()
    ws_cfg = (workspace or {}).get("config") or {}

    def _preview(val) -> str:
        if isinstance(val, list):
            return "; ".join(str(x) for x in val[:3])
        return str(val)

    def source_for(field: str, value) -> dict:
        if not value:
            return {
                "source_type": SOURCE_MISSING,
                "confidence": 0.0,
                "reason": "Поле не заполнено",
                "value_preview": "—",
                "can_accept_reject": False,
            }
        if field == "output_format" and str(value).lower() in lower:
            return {
                "source_type": SOURCE_USER,
                "confidence": 1.0,
                "reason": "Пользователь явно указал формат",
                "value_preview": str(value),
                "can_accept_reject": False,
            }
        if field == "constraints" and any(str(item).lower() in lower for item in value):
            return {
                "source_type": SOURCE_USER,
                "confidence": 0.95,
                "reason": "Ограничения найдены в запросе",
                "value_preview": _preview(value),
                "can_accept_reject": False,
            }
        if field == "constraints" and ws_cfg.get("default_constraints"):
            return {
                "source_type": SOURCE_WORKSPACE,
                "confidence": 0.85,
                "reason": "Ограничения пришли из workspace",
                "value_preview": _preview(value),
                "can_accept_reject": True,
            }
        if field == "source_of_truth" and ws_cfg.get("reference_snippets"):
            return {
                "source_type": SOURCE_WORKSPACE,
                "confidence": 0.8,
                "reason": "Есть reference snippets в workspace",
                "value_preview": _preview(value),
                "can_accept_reject": True,
            }
        if field == "source_of_truth":
            conf = 0.8
            stype = SOURCE_INFERRED if conf >= 0.75 else SOURCE_ASSUMED
            return {
                "source_type": stype,
                "confidence": conf,
                "reason": "Источники выведены из типа входных материалов в запросе",
                "value_preview": _preview(value),
                "can_accept_reject": True,
            }
        if field == "success_criteria":
            conf = 0.75
            stype = SOURCE_INFERRED if conf >= 0.75 else SOURCE_ASSUMED
            return {
                "source_type": stype,
                "confidence": conf,
                "reason": "Критерии успеха выведены из требований к формату, точности и стилю",
                "value_preview": _preview(value),
                "can_accept_reject": True,
            }
        conf = 0.65
        stype = SOURCE_ASSUMED if conf < 0.75 else SOURCE_INFERRED
        return {
            "source_type": stype,
            "confidence": conf,
            "reason": "Поле выведено эвристически",
            "value_preview": _preview(value),
            "can_accept_reject": True,
        }

    fields = {
        "goal": spec.get("goal"),
        "audience": spec.get("audience"),
        "output_format": spec.get("output_format"),
        "constraints": spec.get("constraints"),
        "source_of_truth": spec.get("source_of_truth"),
        "success_criteria": spec.get("success_criteria"),
    }
    return {field: source_for(field, value) for field, value in fields.items()}
