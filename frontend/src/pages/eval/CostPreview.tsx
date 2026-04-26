import { useEffect, useState } from 'react'
import { evalApi, type EvalCostBreakdown, type PreviewCostRequest } from '../../api/eval'
import css from './Stability.module.css'

interface Props {
  // Stable JSON-serializable input. Re-runs the preview when this changes.
  payload: PreviewCostRequest | null
  debounceMs?: number
}

export default function CostPreview({ payload, debounceMs = 400 }: Props) {
  const [data, setData] = useState<EvalCostBreakdown | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!payload) {
      setData(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setErr(null)
    const timer = setTimeout(() => {
      evalApi
        .previewCost(payload)
        .then(d => {
          if (!cancelled) setData(d)
        })
        .catch((e: Error) => {
          if (!cancelled) setErr(e.message)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, debounceMs)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [payload && JSON.stringify(payload), debounceMs])

  if (!payload) return null

  return (
    <div className={`${css.previewBlock} ${data?.over_daily_budget ? css.previewWarn : ''}`}>
      <span className={css.previewKey}>Прогноз</span>
      {loading && <span className={css.muted}>считаем…</span>}
      {err && <span style={{ color: 'rgb(239, 68, 68)' }}>Ошибка: {err}</span>}
      {data && !loading && (
        <>
          <span><b>${data.total_usd.toFixed(4)}</b> {data.pricing_status === 'approximate' && <span className={css.muted}>(≈)</span>}</span>
          <span><b>{data.total_tokens.toLocaleString()}</b> tokens</span>
          <span className={css.muted}>
            генер. ${data.target.usd.toFixed(4)} · судья ${data.judge.usd.toFixed(4)}
            {data.synthesis && data.synthesis.usd > 0 ? ` · мета ${data.synthesis.usd.toFixed(4)}` : ''}
            {' '}· embed ${data.embedding.usd.toFixed(4)}
          </span>
          <span className={css.muted}>дн. бюджет: ${data.daily_remaining_usd.toFixed(2)} / ${data.daily_budget_usd.toFixed(2)}</span>
          {data.over_daily_budget && (
            <span style={{ color: 'rgb(245, 158, 11)', fontWeight: 700 }}>
              ⚠ превышает остаток бюджета
            </span>
          )}
        </>
      )}
    </div>
  )
}
