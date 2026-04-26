"""Multi-step meta-analysis: cluster → hypothesize → verify → synthesize (schema v2)."""
from __future__ import annotations

import json
import uuid
from typing import Any

from services.eval.output_clusters import cluster_result_ids_by_embedding

META_SCHEMA_VERSION = 2

_HYP_SYSTEM = """META_HYPOTHESIZE_V1
You cluster stability-eval outputs. You receive CLUSTERS (each cluster lists result_id and short excerpt + judge score).
Propose 1-6 systematic failure HYPOTHESES (patterns across runs, not one-off noise).
Each hypothesis MUST cite candidate evidence: exact short quotes copied from the excerpts provided (not invented).
Respond JSON only:
{
  "hypotheses": [
    {
      "id": "short slug like fmt_json",
      "pattern": "Russian, one line",
      "cluster_ids": [0,1],
      "evidence_candidates": [{"result_id": 123, "quote": "exact substring from that row excerpt or full output"}]
    }
  ]
}
cluster_ids refer to the cluster index in the user message (0-based). Every hypothesis needs at least one evidence_candidates entry."""

_SYN_SYSTEM = """META_SYNTHESIZE_V2
You write the final meta-report for a prompt engineer. You receive ONLY verified hypotheses (each has evidence quotes already checked against outputs).
Respond JSON only:
{
  "summary": "2-5 sentences Russian",
  "failure_modes": [
    {
      "hypothesis_id": "slug",
      "pattern": "Russian",
      "severity": 1,
      "evidence": [{"result_id": 1, "excerpt": "...", "criterion_key": null}]
    }
  ],
  "prompt_fixes": ["actionable Russian"],
  "criteria_weak_spots": [{"criterion_key": "key or *", "note": "Russian", "hypothesis_id": "slug"}]
}
severity 1-5. evidence must copy excerpts from the verified block verbatim."""


def _norm_match(s: str) -> str:
    return " ".join((s or "").split())


def verify_quote_in_output(output_text: str, quote: str) -> bool:
    if not quote or len(quote.strip()) < 8:
        return False
    hay = _norm_match(output_text)
    needle = _norm_match(quote)
    return needle in hay if needle else False


def _results_side_a(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [r for r in rows if r.get("prompt_side") == "A" and r.get("status") == "ok"]


def run_meta_pipeline(
    *,
    client: Any,
    synthesis_model_id: str,
    task_input: str,
    prompt_a_text: str,
    prompt_b_text: str | None,
    rubric_snapshot: dict[str, Any],
    side_summaries: dict[str, dict],
    result_rows: list[dict[str, Any]],
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, str | None]:
    """Returns (synthesis_report_for_ui, meta_pipeline_blob, error)."""
    side_a = _results_side_a(result_rows)
    if not side_a:
        return None, None, "no_side_a_results"

    by_id = {int(r["id"]): r for r in side_a if r.get("id") is not None}
    cluster_items = [{"id": r["id"], "embedding": r.get("embedding")} for r in side_a]
    clusters = cluster_result_ids_by_embedding(cluster_items, sim_threshold=0.88)

    cluster_payload: list[dict[str, Any]] = []
    for idx, cids in enumerate(clusters):
        members = []
        for rid in cids:
            row = by_id.get(int(rid))
            if not row:
                continue
            ot = str(row.get("output_text") or "")
            excerpt = ot[:1200] + ("…" if len(ot) > 1200 else "")
            members.append(
                {
                    "result_id": int(rid),
                    "run_index": row.get("run_index"),
                    "judge_primary": row.get("judge_overall"),
                    "excerpt": excerpt,
                }
            )
        cluster_payload.append({"cluster_id": idx, "members": members})

    hyp_user = json.dumps(
        {
            "clusters": cluster_payload,
            "rubric": rubric_snapshot.get("name") or rubric_snapshot.get("preset_key"),
            "task_excerpt": task_input[:2000],
        },
        ensure_ascii=False,
    )

    try:
        hyp_raw = client.generate_json(
            system_prompt=_HYP_SYSTEM,
            user_content=hyp_user,
            provider=synthesis_model_id,
            max_tokens=2048,
        )
    except Exception as exc:  # noqa: BLE001
        return None, None, f"hypothesize:{exc}"

    hypotheses = []
    if isinstance(hyp_raw, dict):
        hypotheses = hyp_raw.get("hypotheses") or []
    if not isinstance(hypotheses, list):
        hypotheses = []

    verified: list[dict[str, Any]] = []
    for h in hypotheses:
        if not isinstance(h, dict):
            continue
        hid = str(h.get("id") or "") or f"h_{uuid.uuid4().hex[:8]}"
        pattern = str(h.get("pattern") or "").strip()
        if not pattern:
            continue
        ev_out: list[dict[str, Any]] = []
        for cand in h.get("evidence_candidates") or []:
            if not isinstance(cand, dict):
                continue
            try:
                rid = int(cand.get("result_id"))
            except (TypeError, ValueError):
                continue
            quote = str(cand.get("quote") or "")
            row = by_id.get(rid)
            if not row:
                continue
            if verify_quote_in_output(str(row.get("output_text") or ""), quote):
                ev_out.append({"result_id": rid, "excerpt": quote[:800]})
        if ev_out:
            verified.append(
                {
                    "id": hid,
                    "pattern": pattern,
                    "cluster_ids": h.get("cluster_ids") if isinstance(h.get("cluster_ids"), list) else [],
                    "evidence": ev_out,
                }
            )

    if not verified:
        verified.append(
            {
                "id": "no_verified_hypotheses",
                "pattern": "Явных повторяющихся сбоев с подтверждающими цитатами не выявлено",
                "cluster_ids": [],
                "evidence": [],
            }
        )

    syn_user = json.dumps(
        {
            "verified_hypotheses": verified,
            "aggregates": side_summaries,
            "prompt_a_excerpt": prompt_a_text[:2000],
        },
        ensure_ascii=False,
    )

    try:
        syn_raw = client.generate_json(
            system_prompt=_SYN_SYSTEM,
            user_content=syn_user,
            provider=synthesis_model_id,
            max_tokens=2048,
        )
    except Exception as exc:  # noqa: BLE001
        return None, {"clusters": cluster_payload, "verified_hypotheses": verified}, f"synthesize:{exc}"

    if not isinstance(syn_raw, dict):
        return None, {"clusters": cluster_payload, "verified_hypotheses": verified}, "synthesize_invalid"

    failure_modes_out: list[dict[str, Any]] = []
    for fm in syn_raw.get("failure_modes") or []:
        if not isinstance(fm, dict):
            continue
        ev_list = []
        for e in fm.get("evidence") or []:
            if not isinstance(e, dict):
                continue
            try:
                rid = int(e.get("result_id"))
            except (TypeError, ValueError):
                continue
            excerpt = str(e.get("excerpt") or "")
            row = by_id.get(rid)
            if row and verify_quote_in_output(str(row.get("output_text") or ""), excerpt):
                ev_list.append(
                    {
                        "result_id": rid,
                        "excerpt": excerpt[:800],
                        "criterion_key": e.get("criterion_key"),
                    }
                )
        hid = str(fm.get("hypothesis_id") or "")
        pattern = str(fm.get("pattern") or "").strip()
        if not pattern:
            continue
        sev = fm.get("severity")
        try:
            sev_i = int(sev) if sev is not None else 2
        except (TypeError, ValueError):
            sev_i = 2
        sev_i = max(1, min(5, sev_i))
        evidence_str = "; ".join(f"#{e['result_id']}: {e['excerpt'][:120]}…" if len(e["excerpt"]) > 120 else f"#{e['result_id']}: {e['excerpt']}" for e in ev_list)
        failure_modes_out.append(
            {
                "pattern": pattern,
                "severity": sev_i,
                "evidence": evidence_str or "(verified pipeline — see evidence_spans)",
                "hypothesis_id": hid,
                "evidence_spans": ev_list,
            }
        )

    summary = str(syn_raw.get("summary") or "").strip()
    prompt_fixes = [str(x) for x in (syn_raw.get("prompt_fixes") or []) if str(x).strip()]
    cws = []
    for cw in syn_raw.get("criteria_weak_spots") or []:
        if isinstance(cw, dict) and (cw.get("note") or "").strip():
            cws.append(
                {
                    "criterion_key": str(cw.get("criterion_key") or "*"),
                    "note": str(cw.get("note") or ""),
                    "hypothesis_id": str(cw.get("hypothesis_id") or ""),
                }
            )

    synthesis_report = {
        "meta_schema_version": META_SCHEMA_VERSION,
        "summary": summary,
        "failure_modes": failure_modes_out,
        "prompt_fixes": prompt_fixes,
        "criteria_weak_spots": cws,
    }

    meta_blob = {
        "schema_version": META_SCHEMA_VERSION,
        "clusters": cluster_payload,
        "hypotheses_raw": hypotheses,
        "verified_hypotheses": verified,
        "synthesis_raw": syn_raw,
    }

    if not summary and not failure_modes_out and not prompt_fixes:
        return None, meta_blob, "synthesis_empty"

    return synthesis_report, meta_blob, None
