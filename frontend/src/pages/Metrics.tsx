import { useEffect, useState } from 'react'
import { api } from '../api/client'
import styles from './Metrics.module.css'

export default function Metrics() {
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null)
  const [events, setEvents] = useState<Record<string, unknown>[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.getMetricsSummary(), api.getMetricsEvents(25)])
      .then(([summaryRes, eventsRes]) => {
        setSummary(summaryRes)
        setEvents(eventsRes.items)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'))
  }, [])

  if (error) return <p className={styles.error}>{error}</p>
  if (!summary) return <p>Загрузка...</p>

  const funnel = [
    { label: 'Generate', value: Number(summary.generate_requests || 0) },
    { label: 'Questions', value: Number(summary.generated_questions || 0) },
    { label: 'Prompts', value: Number(summary.generated_prompts || 0) },
    { label: 'Saved', value: Number(summary.saved_prompts || 0) },
  ]
  const funnelMax = Math.max(...funnel.map((item) => item.value), 1)
  const eventCounts = Object.entries((summary.event_counts || {}) as Record<string, number>).sort((a, b) => b[1] - a[1])
  const latencyScore = Math.max(Number(summary.p95_generation_latency_ms || 0), Number(summary.avg_generation_latency_ms || 0), 1)

  return (
    <div className={styles.metrics}>
      <h1 className={styles.title}>Продуктовые метрики</h1>
      <p className={styles.caption}>Локальная телеметрия usage и outcome сигналов для web-версии.</p>

      <div className={styles.grid}>
        <div className={styles.card}><strong>Запросов на генерацию</strong><span>{String(summary.generate_requests ?? 0)}</span></div>
        <div className={styles.card}><strong>Готовых промптов</strong><span>{String(summary.generated_prompts ?? 0)}</span></div>
        <div className={styles.card}><strong>Сохранений</strong><span>{String(summary.saved_prompts ?? 0)}</span></div>
        <div className={styles.card}><strong>A/B запусков</strong><span>{String(summary.compare_runs ?? 0)}</span></div>
        <div className={styles.card}><strong>Acceptance rate</strong><span>{String(summary.prompt_acceptance_rate ?? 0)}%</span></div>
        <div className={styles.card}><strong>Save-to-library</strong><span>{String(summary.save_to_library_rate ?? 0)}%</span></div>
        <div className={styles.card}><strong>Q&A response</strong><span>{String(summary.questions_response_rate ?? 0)}%</span></div>
        <div className={styles.card}><strong>Средний completeness</strong><span>{String(summary.avg_prompt_completeness ?? 0)}%</span></div>
        <div className={styles.card}><strong>Средняя latency</strong><span>{String(summary.avg_generation_latency_ms ?? 0)} ms</span></div>
        <div className={styles.card}><strong>P95 latency</strong><span>{String(summary.p95_generation_latency_ms ?? 0)} ms</span></div>
        <div className={styles.card}><strong>Итераций запущено</strong><span>{String(summary.iterations_started ?? 0)}</span></div>
      </div>

      <div className={styles.visualGrid}>
        <div className={styles.section}>
          <h2>Session funnel</h2>
          <div className={styles.funnel}>
            {funnel.map((item) => (
              <div key={item.label} className={styles.funnelRow}>
                <span>{item.label}</span>
                <div className={styles.funnelBar}>
                  <div className={styles.funnelFill} style={{ width: `${(item.value / funnelMax) * 100}%` }} />
                </div>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.section}>
          <h2>Latency snapshot</h2>
          <div className={styles.latencyBox}>
            <div>
              <span>AVG</span>
              <div className={styles.latencyMeter}>
                <div className={styles.latencyAvg} style={{ width: `${(Number(summary.avg_generation_latency_ms || 0) / latencyScore) * 100}%` }} />
              </div>
            </div>
            <div>
              <span>P95</span>
              <div className={styles.latencyMeter}>
                <div className={styles.latencyP95} style={{ width: `${(Number(summary.p95_generation_latency_ms || 0) / latencyScore) * 100}%` }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <details className={styles.section}>
        <summary>События</summary>
        <div className={styles.eventBars}>
          {eventCounts.map(([name, count]) => (
            <div key={name} className={styles.eventBarRow}>
              <code>{name}</code>
              <div className={styles.eventBar}>
                <div className={styles.eventBarFill} style={{ width: `${(count / Math.max(eventCounts[0]?.[1] || 1, 1)) * 100}%` }} />
              </div>
              <strong>{count}</strong>
            </div>
          ))}
        </div>
      </details>

      <div className={styles.section}>
        <h2>Последние события</h2>
        {events.length === 0 ? (
          <p>История событий пуста.</p>
        ) : (
          <div className={styles.eventList}>
            {events.map((event, idx) => (
              <div key={idx} className={styles.eventCard}>
                <strong>{String(event.event_name || '')}</strong>
                <p>{String(event.created_at || '')}</p>
                <pre>{JSON.stringify(event.payload || {}, null, 2).slice(0, 300)}</pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
