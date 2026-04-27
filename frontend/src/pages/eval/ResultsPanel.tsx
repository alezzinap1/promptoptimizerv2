import { useMemo } from 'react'
import {
  downloadEvalRunMarkdown,
  type EvalMetaCluster,
  type EvalRunDetail,
  type EvalResultRow,
  type EvalVerifiedHypothesis,
} from '../../api/eval'
import { useSimulatedLlmStream } from '../../lib/simulatedLlmStream'
import css from './Stability.module.css'

function SynthesisSummaryStreamed({ text }: { text: string }) {
  const s = useSimulatedLlmStream(text, { suspend: false })
  return <p className={css.synthesisSummary}>{s}</p>
}

function ResultsEvalRow({ r }: { r: EvalResultRow }) {
  const bodySource =
    r.status === 'ok' ? (r.output_text ?? '') : `[error] ${r.error ?? 'unknown'}`
  const out = useSimulatedLlmStream(bodySource, { suspend: false })
  const j1 = useSimulatedLlmStream(r.judge_reasoning ?? '', { suspend: !r.judge_reasoning })
  const j2 = useSimulatedLlmStream(r.judge_reasoning_secondary ?? '', {
    suspend: !r.judge_reasoning_secondary,
  })
  return (
    <div id={`eval-result-${r.id}`} className={css.outputItem}>
      <div className={css.outputHeader}>
        <span>
          #{r.run_index} · {r.latency_ms ?? '?'}ms
        </span>
        <span className={css.scoreBadge}>
          {r.judge_overall != null ? r.judge_overall.toFixed(2) : '—'}
          {r.judge_overall_secondary != null ? ` / ₂${r.judge_overall_secondary.toFixed(2)}` : ''}
        </span>
      </div>
      <div className={css.outputText}>{out}</div>
      {r.judge_reasoning ? (
        <div className={css.muted} style={{ fontSize: 11, marginTop: 4 }}>
          judge₁: {j1}
        </div>
      ) : null}
      {r.judge_reasoning_secondary ? (
        <div className={css.muted} style={{ fontSize: 11, marginTop: 4 }}>
          judge₂: {j2}
        </div>
      ) : null}
    </div>
  )
}

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
          {rows.map((r) => (
            <ResultsEvalRow key={r.id} r={r} />
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
          <SynthesisSummaryStreamed text={rep.summary ?? ''} />
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

      {run.meta_pipeline && run.meta_pipeline.schema_version === 2 && (
        <details className={css.metaPipelineDetails}>
          <summary className={css.metaPipelineSummary}>
            Технический разбор мета-цепочки (кластеры и проверенные гипотезы)
          </summary>
          <div className={css.metaPipelineBody}>
            {Array.isArray(run.meta_pipeline.clusters) && run.meta_pipeline.clusters.length > 0 && (
              <div className={css.metaPipelineBlock}>
                <div className={css.synthesisSub}>Кластеры по эмбеддингам</div>
                <ul className={css.metaPipelineList}>
                  {(run.meta_pipeline.clusters as EvalMetaCluster[]).map((c, i) => (
                    <li key={i}>
                      #{c.cluster_id ?? i}:{' '}
                      {(c.members || []).length} ответ(ов), id:{' '}
                      {(c.members || [])
                        .map(m => m.result_id)
                        .filter(Boolean)
                        .join(', ')}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {Array.isArray(run.meta_pipeline.verified_hypotheses) &&
              run.meta_pipeline.verified_hypotheses.length > 0 && (
                <div className={css.metaPipelineBlock}>
                  <div className={css.synthesisSub}>После проверки цитат</div>
                  <ul className={css.metaPipelineList}>
                    {(run.meta_pipeline.verified_hypotheses as EvalVerifiedHypothesis[]).map((h, i) => (
                      <li key={i}>
                        <b>{h.id || '—'}</b>: {h.pattern || '—'} ({(h.evidence || []).length} цитат)
                      </li>
                    ))}
                  </ul>
                </div>
              )}
          </div>
        </details>
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
