import { useEffect, useState } from 'react'
import { evalApi, type EvalRunSummary } from '../../api/eval'
import css from './Stability.module.css'

interface Props {
  onClose(): void
  onPick(runId: number): void
}

const STATUS_CLASS: Record<EvalRunSummary['status'], string> = {
  completed: css.statusCompleted,
  running: css.statusRunning,
  queued: css.statusRunning,
  failed: css.statusFailed,
  cancelled: css.statusCancelled,
}

export default function EvalRunsHistory({ onClose, onPick }: Props) {
  const [runs, setRuns] = useState<EvalRunSummary[]>([])
  const [err, setErr] = useState<string | null>(null)

  const reload = () => {
    evalApi
      .listRuns(50)
      .then(r => setRuns(r.runs))
      .catch((e: Error) => setErr(e.message))
  }

  useEffect(() => {
    reload()
  }, [])

  const onDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await evalApi.deleteRun(id)
      reload()
    } catch (ex) {
      setErr((ex as Error).message)
    }
  }

  return (
    <div className={css.historyDrawer}>
      <div className={css.historyHead}>
        <h3 style={{ margin: 0, fontSize: 16 }}>История runs</h3>
        <button type="button" className={css.ghostBtn} onClick={onClose}>Закрыть</button>
      </div>

      {err && <div className={css.errorBox}>{err}</div>}

      {runs.length === 0 && (
        <div className={css.muted} style={{ fontSize: 13 }}>Пока ничего не запускалось.</div>
      )}

      {runs.map(r => (
        <div key={r.id} className={css.historyItem} onClick={() => onPick(r.id)}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 700 }}>#{r.id} · {r.mode}</span>
            <span className={STATUS_CLASS[r.status] || css.statusFailed}>{r.status}</span>
          </div>
          <div className={css.muted} style={{ fontSize: 11, marginTop: 4 }}>
            {r.target_model_id} · n={r.n_runs} · {new Date(r.created_at).toLocaleString()}
          </div>
          {r.agg_overall_p50 != null && (
            <div style={{ marginTop: 4 }}>
              p50: <b>{r.agg_overall_p50.toFixed(2)}</b>
              {r.diversity_score != null && <span className={css.muted}> · div: {r.diversity_score.toFixed(2)}</span>}
              {r.cost_actual_usd != null && <span className={css.muted}> · ${r.cost_actual_usd.toFixed(4)}</span>}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
            <button
              type="button"
              className={css.ghostBtn}
              style={{ fontSize: 11, padding: '2px 8px' }}
              onClick={e => onDelete(r.id, e)}
            >
              Удалить
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
