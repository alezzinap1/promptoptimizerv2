import { useEffect, useState } from 'react'
import { subscribeEvalRunStream, type EvalStreamEvent } from '../../api/eval'
import css from './Stability.module.css'

interface Props {
  runId: number
  totalGenerations: number
  onDone: (status: string) => void
  onCancel?: () => void
}

interface Counters {
  generated: number
  judged: number
  embedded: number
  pairs: number
}

export default function RunningStream({ runId, totalGenerations, onDone, onCancel }: Props) {
  const [events, setEvents] = useState<EvalStreamEvent[]>([])
  const [counters, setCounters] = useState<Counters>({ generated: 0, judged: 0, embedded: 0, pairs: 0 })
  const [status, setStatus] = useState<'connecting' | 'live' | 'done' | 'error'>('connecting')
  const [doneStatus, setDoneStatus] = useState<string | null>(null)

  useEffect(() => {
    setEvents([])
    setCounters({ generated: 0, judged: 0, embedded: 0, pairs: 0 })
    setStatus('connecting')
    setDoneStatus(null)

    const handle = subscribeEvalRunStream(
      runId,
      evt => {
        setEvents(prev => [...prev, evt])
        if (evt.type === 'started') {
          setStatus('live')
        } else if (evt.type === 'progress') {
          setCounters(prev => {
            switch (evt.phase) {
              case 'generate':
                return { ...prev, generated: prev.generated + 1 }
              case 'judge':
                return { ...prev, judged: prev.judged + 1 }
              case 'judge_secondary':
                return { ...prev, judged: prev.judged + 1 }
              case 'embed':
                return { ...prev, embedded: prev.embedded + ((evt as { count?: number }).count ?? 0) }
              case 'pair_judge':
                return { ...prev, pairs: prev.pairs + 1 }
              default:
                return prev
            }
          })
        } else if (evt.type === 'done') {
          setStatus('done')
          setDoneStatus(evt.status)
          onDone(evt.status)
        }
      },
      () => setStatus('error'),
    )
    return () => handle.close()
  }, [runId, onDone])

  const pct = totalGenerations > 0 ? Math.min(100, Math.round((counters.generated / totalGenerations) * 100)) : 0

  return (
    <div className={css.composer}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Run #{runId}</div>
          <div className={css.muted} style={{ fontSize: 11 }}>
            {status === 'connecting' && 'подключаемся к потоку…'}
            {status === 'live' && 'живая трансляция'}
            {status === 'done' && `завершено (${doneStatus})`}
            {status === 'error' && 'ошибка стрима'}
          </div>
        </div>
        {status === 'live' && onCancel && (
          <button type="button" className={css.cancelBtn} onClick={onCancel}>
            Отмена
          </button>
        )}
      </div>

      <div className={css.progressBar}>
        <div className={css.progressFill} style={{ width: `${pct}%` }} />
      </div>

      <div className={css.statRow}>
        <div className={css.stat}>
          <span className={css.statLabel}>Сгенерировано</span>
          <span className={css.statVal}>{counters.generated} / {totalGenerations}</span>
        </div>
        <div className={css.stat}>
          <span className={css.statLabel}>Оценено судьёй</span>
          <span className={css.statVal}>{counters.judged}</span>
        </div>
        <div className={css.stat}>
          <span className={css.statLabel}>Эмбеддингов</span>
          <span className={css.statVal}>{counters.embedded}</span>
        </div>
        {counters.pairs > 0 && (
          <div className={css.stat}>
            <span className={css.statLabel}>Pair-сравнений</span>
            <span className={css.statVal}>{counters.pairs}</span>
          </div>
        )}
      </div>

      <div className={css.streamBox}>
        {events.slice(-30).map((e, i) => (
          <div key={i}>
            {e.type === 'started' && `▶ start (n=${(e as { n_runs: number }).n_runs}, mode=${(e as { mode: string }).mode})`}
            {e.type === 'progress' && (() => {
              const ev = e as { phase: string; side?: string; run_index?: number; status?: string; preview?: string; count?: number; judge_overall?: number; winner?: string }
              if (ev.phase === 'generate') return `· generate ${ev.side}/${ev.run_index} ${ev.status === 'ok' ? 'ok' : '✗'} ${ev.preview ?? ''}`
              if (ev.phase === 'judge') return `· judge ${ev.side}/${ev.run_index} → ${ev.judge_overall?.toFixed(2) ?? 'n/a'}`
              if (ev.phase === 'embed') return ev.count !== undefined ? `· embed ${ev.count}` : '· embed (skipped)'
              if (ev.phase === 'pair_judge') return `· pair → ${ev.winner ?? '?'}`
              return ''
            })()}
            {e.type === 'summary' && '∑ summary'}
            {e.type === 'done' && `✓ done (${(e as { status: string }).status})`}
          </div>
        ))}
      </div>
    </div>
  )
}
