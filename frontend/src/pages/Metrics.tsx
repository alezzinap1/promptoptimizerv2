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

  return (
    <div className={styles.metrics}>
      <h1>Продуктовые метрики</h1>
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

      <details className={styles.section}>
        <summary>События</summary>
        <ul>
          {Object.entries((summary.event_counts || {}) as Record<string, number>).map(([name, count]) => (
            <li key={name}><code>{name}</code>: {count}</li>
          ))}
        </ul>
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
