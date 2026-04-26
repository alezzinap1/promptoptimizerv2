import { useMemo } from 'react'
import { downloadEvalRunMarkdown, type EvalRunDetail, type EvalResultRow } from '../../api/eval'
import css from './Stability.module.css'

interface Props {
  detail: EvalRunDetail
}

function scrollToResult(resultId: number) {
  const el = document.getElementById(`eval-result-${resultId}`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

export default function ResultsPanel({ detail }: Props) {
  const { run, results } = detail
  const sides = useMemo(() => {
    const a = results.filter(r => r.prompt_side === 'A')
    const b = results.filter(r => r.prompt_side === 'B')
    return { A: a, B: b }
  }, [results])

  const stats = (rows: EvalResultRow[]) => {
    const ok = rows.filter(r => r.status === 'ok' && r.judge_overall != null)
    const scores = ok.map(r => r.judge_overall as number).sort((a, b) => a - b)
    if (!scores.length) return null
    const pick = (q: number) => {
      if (scores.length === 1) return scores[0]
      const pos = q * (scores.length - 1)
      const lo = Math.floor(pos)
      const hi = Math.ceil(pos)
      return scores[lo] + (scores[hi] - scores[lo]) * (pos - lo)
    }
    return { p10: pick(0.1), p50: pick(0.5), p90: pick(0.9), n: scores.length, errors: rows.length - ok.length }
  }

  const renderSide = (side: 'A' | 'B') => {
    const rows = sides[side]
    if (!rows.length) return null
    const s = stats(rows)
    return (
      <div className={css.sideCard}>
        <div className={css.sideTitle}>
          Prompt {side} <span className={css.muted} style={{ fontSize: 11 }}>({rows.length} итераций)</span>
        </div>
        {s && (
          <div className={css.statRow}>
            <div className={css.stat}>
              <span className={css.statLabel}>p50</span>
              <span className={css.statVal}>{s.p50.toFixed(2)}</span>
            </div>
            <div className={css.stat}>
              <span className={css.statLabel}>p10–p90</span>
              <span className={css.statVal}>{s.p10.toFixed(1)}–{s.p90.toFixed(1)}</span>
            </div>
            <div className={css.stat}>
              <span className={css.statLabel}>Diversity</span>
              <span className={css.statVal}>
                {side === 'A' && run.diversity_score != null ? run.diversity_score.toFixed(2) : '–'}
              </span>
            </div>
            {s.errors > 0 && (
              <div className={css.stat}>
                <span className={css.statLabel}>Ошибок</span>
                <span className={css.statVal}>{s.errors}</span>
              </div>
            )}
          </div>
        )}
        <div className={css.outputList}>
          {rows.map(r => (
            <div key={r.id} id={`eval-result-${r.id}`} className={css.outputItem}>
              <div className={css.outputHeader}>
                <span>#{r.run_index} · {r.latency_ms ?? '?'}ms</span>
                <span className={css.scoreBadge}>
                  {r.judge_overall != null ? r.judge_overall.toFixed(2) : '—'}
                  {r.judge_overall_secondary != null
                    ? ` / ₂${r.judge_overall_secondary.toFixed(2)}`
                    : ''}
                </span>
              </div>
              <div className={css.outputText}>
                {r.status === 'ok' ? r.output_text : `[error] ${r.error ?? 'unknown'}`}
              </div>
              {r.judge_reasoning && (
                <div className={css.muted} style={{ fontSize: 11, marginTop: 4 }}>
                  judge₁: {r.judge_reasoning}
                </div>
              )}
              {r.judge_reasoning_secondary && (
                <div className={css.muted} style={{ fontSize: 11, marginTop: 4 }}>
                  judge₂: {r.judge_reasoning_secondary}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  }

  const rep = run.synthesis_report

  return (
    <div>
      <div className={css.resultsToolbar}>
        <button type="button" className={css.btnGhost} onClick={() => downloadEvalRunMarkdown(detail)}>
          Скачать отчёт (.md)
        </button>
        {run.judge_agreement_mean_abs != null && (
          <span className={css.muted} style={{ fontSize: 12 }}>
            Средн. расхождение судей (|Δ балл|): <b>{run.judge_agreement_mean_abs.toFixed(3)}</b>
          </span>
        )}
      </div>

      {rep && (
        <div className={css.synthesisCard}>
          <div className={css.synthesisTitle}>
            Мета-анализ (все ответы + промпт)
            {rep.meta_schema_version === 2 && (
              <span className={css.muted} style={{ fontSize: 11, marginLeft: 8 }}>
                v2 · с цитатами
              </span>
            )}
          </div>
          <p className={css.synthesisSummary}>{rep.summary}</p>
          {rep.failure_modes && rep.failure_modes.length > 0 && (
            <div className={css.synthesisSection}>
              <div className={css.synthesisSub}>Паттерны сбоев</div>
              <ul className={css.synthesisList}>
                {rep.failure_modes.map((f, i) => (
                  <li key={i}>
                    <b>{f.pattern}</b> (важн. {f.severity}): {f.evidence}
                    {f.evidence_spans && f.evidence_spans.length > 0 && (
                      <div className={css.evidenceSpans}>
                        {f.evidence_spans.map((ev, j) => (
                          <button
                            key={j}
                            type="button"
                            className={css.evidenceLink}
                            onClick={() => scrollToResult(ev.result_id)}
                          >
                            #{ev.result_id}: «{ev.excerpt.slice(0, 120)}
                            {ev.excerpt.length > 120 ? '…' : ''}»
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {rep.prompt_fixes && rep.prompt_fixes.length > 0 && (
            <div className={css.synthesisSection}>
              <div className={css.synthesisSub}>Что усилить в промпте</div>
              <ul className={css.synthesisList}>
                {rep.prompt_fixes.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {run.synthesis_error && (
        <div className={css.errorBox} style={{ marginBottom: 12 }}>
          Мета-анализ не удался: {run.synthesis_error}
        </div>
      )}

      {run.mode === 'pair' && run.pair_winner && (
        <div className={css.pairBanner}>
          <span>Pair-judge:</span>
          <span className={css.winnerBadge}>winner = {run.pair_winner}</span>
          <span className={css.muted}>уверенность {run.pair_winner_confidence?.toFixed(2) ?? '—'}</span>
        </div>
      )}
      <div className={css.resultsGrid} style={{ marginTop: 12 }}>
        {renderSide('A')}
        {run.mode === 'pair' && renderSide('B')}
      </div>
    </div>
  )
}
