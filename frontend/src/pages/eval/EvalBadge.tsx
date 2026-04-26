import { useEffect, useState } from 'react'
import { evalApi, type EvalLibrarySummary } from '../../api/eval'
import css from './Stability.module.css'

interface Props {
  libraryId: number
}

export default function EvalBadge({ libraryId }: Props) {
  const [data, setData] = useState<EvalLibrarySummary | null>(null)

  useEffect(() => {
    let cancelled = false
    evalApi
      .getLibraryEvalSummary(libraryId)
      .then(r => {
        if (!cancelled) setData(r)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [libraryId])

  if (!data || !data.last) return null
  const { last } = data
  if (last.agg_overall_p50 == null) return null
  return (
    <span
      className={css.evalBadge}
      title={`Стабильность: p50=${last.agg_overall_p50.toFixed(2)} · diversity=${last.diversity_score?.toFixed(2) ?? '–'}`}
    >
      ⚖ {last.agg_overall_p50.toFixed(1)}
      {last.diversity_score != null && <span className={css.muted}>±{last.diversity_score.toFixed(2)}</span>}
    </span>
  )
}
