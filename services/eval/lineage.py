"""Stable fingerprints for eval run series (C1/C2 trends)."""
from __future__ import annotations

import hashlib
import json
from typing import Any


def normalize_text(s: str) -> str:
    t = (s or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    return "\n".join(line.rstrip() for line in t.split("\n"))


def prompt_fingerprint(prompt_a_text: str, prompt_b_text: str | None) -> str:
    body = normalize_text(prompt_a_text)
    if (prompt_b_text or "").strip():
        body += "\n---PROMPT_B---\n" + normalize_text(prompt_b_text or "")
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def task_fingerprint(task_input: str, reference_answer: str | None) -> str:
    parts = [normalize_text(task_input)]
    if (reference_answer or "").strip():
        parts.append("---REF---\n" + normalize_text(reference_answer or ""))
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()


def rubric_fingerprint(rubric_snapshot: dict[str, Any]) -> str:
    crit = rubric_snapshot.get("criteria") or []
    minimal = {
        "preset_key": rubric_snapshot.get("preset_key"),
        "name": rubric_snapshot.get("name"),
        "criteria": [
            {"key": c.get("key"), "weight": float(c.get("weight") or 0)}
            for c in crit
            if c.get("key")
        ],
    }
    canonical = json.dumps(minimal, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def fingerprints_for_stored_run(run: dict[str, Any]) -> tuple[str, str, str]:
    """Compute triple from a DB eval_runs row dict (with rubric_snapshot parsed)."""
    pfp = prompt_fingerprint(str(run.get("prompt_a_text") or ""), run.get("prompt_b_text"))
    tfp = task_fingerprint(str(run.get("task_input") or ""), run.get("reference_answer"))
    snap = run.get("rubric_snapshot") or {}
    rfp = rubric_fingerprint(snap if isinstance(snap, dict) else {})
    return pfp, tfp, rfp
