import { useEffect, useState } from 'react'
import { api } from '../api/client'
import styles from '../pages/Metrics.module.css'

function formatEventPayload(payload: unknown): string {
  if (payload === null || payload === undefined) return ''
  try {
    const s = JSON.stringify(payload)
    return s.length > 220 ? `${s.slice(0, 217)}…` : s
  } catch {
    return String(payload)
  }
}

/** Продуктовые метрики (раньше отдельная страница /metrics). */
export default function ProductMetrics() {
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null)
  const [events, setEvents] = useState<Record<string, unknown>[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.getMetricsSummary(), api.getMetricsEvents(40)])
      .then(([summaryRes, eventsRes]) => {
        setSummary(summaryRes)
        setEvents(eventsRes.items)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'))
  }, [])

  if (error) return <p className={styles.error}>{error}</p>
  if (!summary) return <p className={styles.loadingMetrics}>Загрузка метрик…</p>

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
    <div className={styles.metrics} id="product-metrics">
      <h2 className={styles.title}>Продуктовые метрики</h2>
      <p className={styles.caption}>Локальная телеметрия usage и outcome для web-версии.</p>

      <div className={styles.pageColumns}>
        <div className={styles.leftColumn}>
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
              <h3 className={styles.subsectionTitle}>Session funnel</h3>
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
              <h3 className={styles.subsectionTitle}>Latency snapshot</h3>
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
            <summary>События (агрегаты)</summary>
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
        </div>

        <aside className={styles.eventsColumn}>
          <h3 className={styles.eventsTitle}>Последние события</h3>
          {events.length === 0 ? (
            <p className={styles.consoleEmpty}>История пуста.</p>
          ) : (
            <div className={styles.console} role="log" aria-label="Лог событий">
              {events.map((event, idx) => (
                <div key={idx} className={styles.consoleLine}>
                  <span className={styles.consoleTime}>{String(event.created_at || '').replace('T', ' ').slice(0, 19)}</span>
                  <span className={styles.consoleName}>{String(event.event_name || '—')}</span>
                  <span className={styles.consolePayload}>{formatEventPayload(event.payload)}</span>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
