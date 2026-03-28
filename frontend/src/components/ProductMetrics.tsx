import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { shortGenerationModelLabel } from '../utils/generationModelLabel'
import styles from '../pages/Metrics.module.css'

const MIN_SESSIONS_FOR_STATS = 5

function msToSecondsLabel(ms: unknown): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
  const s = Math.max(1, Math.round(ms / 1000))
  return `${s} сек`
}

function formatEventDate(iso: unknown): string {
  const s = typeof iso === 'string' ? iso : ''
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s.slice(0, 10)
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const EVENT_TITLE: Record<string, string> = {
  simple_improve_success: 'Улучшен промпт',
  simple_improve_requested: 'Запрос улучшения',
  generation_result: 'Ответ генерации',
  generate_prompt_success: 'Промпт создан',
  generate_questions: 'Уточняющие вопросы',
  generate_raw_text: 'Ответ без разбора',
  generate_requested: 'Запрос генерации',
  compare_run: 'Сравнение A/B',
  prompt_saved_to_library: 'Сохранено в библиотеку',
  iteration_started: 'Итерация',
  questions_answered: 'Ответы на вопросы',
  questions_skipped: 'Вопросы пропущены',
  library_open_prompt: 'Открыт промпт',
  library_delete_prompt: 'Удаление из библиотеки',
}

function humanEventLine(event: Record<string, unknown>): string {
  const name = String(event.event_name || '')
  const title = EVENT_TITLE[name] || name.replace(/_/g, ' ')
  const payload = (event.payload && typeof event.payload === 'object' ? event.payload : {}) as Record<
    string,
    unknown
  >
  const parts: string[] = [formatEventDate(event.created_at), title]
  const gm = payload.gen_model
  if (typeof gm === 'string' && gm.trim()) {
    parts.push(shortGenerationModelLabel(gm))
  }
  const lat = msToSecondsLabel(payload.latency_ms)
  if (lat) parts.push(lat)
  return parts.join(' · ')
}

/** Продуктовые метрики в профиле — без сырого JSON и «нулевого» дашборда */
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

  const generateRequests = Number(summary.generate_requests || 0)
  const hasEnoughData = generateRequests >= MIN_SESSIONS_FOR_STATS

  const funnel = [
    { label: 'Генерации', value: generateRequests },
    { label: 'Уточняющие вопросы', value: Number(summary.generated_questions || 0) },
    { label: 'Промпты', value: Number(summary.generated_prompts || 0) },
    { label: 'Сохранения', value: Number(summary.saved_prompts || 0) },
  ]
  const funnelMax = Math.max(...funnel.map((item) => item.value), 1)

  const avgMs = Number(summary.avg_generation_latency_ms || 0)
  const p95Ms = Number(summary.p95_generation_latency_ms || 0)
  const latencyScore = Math.max(p95Ms, avgMs, 1)

  return (
    <div className={styles.metrics} id="product-metrics">
      <h2 className={styles.title}>Активность</h2>
      <p className={styles.caption}>Краткая сводка использования веб-приложения.</p>

      {!hasEnoughData ? (
        <div className={styles.metricsEmpty}>
          <p className={styles.metricsEmptyTitle}>Начните создавать промпты</p>
          <p className={styles.metricsEmptyText}>
            Статистика и подробности появятся здесь после нескольких запросов на главной (от {MIN_SESSIONS_FOR_STATS}{' '}
            и больше).
          </p>
        </div>
      ) : (
        <div className={styles.pageColumns}>
          <div className={styles.leftColumn}>
            <div className={styles.grid}>
              <div className={styles.card}>
                <strong>Запросов на генерацию</strong>
                <span>{String(summary.generate_requests ?? 0)}</span>
              </div>
              <div className={styles.card}>
                <strong>Готовых промптов</strong>
                <span>{String(summary.generated_prompts ?? 0)}</span>
              </div>
              <div className={styles.card}>
                <strong>Сохранений в библиотеку</strong>
                <span>{String(summary.saved_prompts ?? 0)}</span>
              </div>
              <div className={styles.card}>
                <strong>Сравнений A/B</strong>
                <span>{String(summary.compare_runs ?? 0)}</span>
              </div>
              {Number(summary.generated_prompts || 0) > 0 ? (
                <>
                  <div className={styles.card}>
                    <strong>Доля сохранений</strong>
                    <span>{String(summary.save_to_library_rate ?? 0)}%</span>
                  </div>
                  <div className={styles.card}>
                    <strong>Ответы на вопросы</strong>
                    <span>{String(summary.questions_response_rate ?? 0)}%</span>
                  </div>
                </>
              ) : null}
              {avgMs > 0 ? (
                <div className={styles.card}>
                  <strong>Среднее время ответа</strong>
                  <span>{msToSecondsLabel(avgMs)}</span>
                </div>
              ) : null}
              {p95Ms > 0 ? (
                <div className={styles.card}>
                  <strong>Типичный максимум (P95)</strong>
                  <span>{msToSecondsLabel(p95Ms)}</span>
                </div>
              ) : null}
            </div>

            <div className={styles.visualGrid}>
              <div className={styles.section}>
                <h3 className={styles.subsectionTitle}>Воронка</h3>
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

              {avgMs > 0 && p95Ms > 0 ? (
                <div className={styles.section}>
                  <h3 className={styles.subsectionTitle}>Время ответа</h3>
                  <div className={styles.latencyBox}>
                    <div>
                      <span>Среднее</span>
                      <div className={styles.latencyMeter}>
                        <div
                          className={styles.latencyAvg}
                          style={{ width: `${(avgMs / latencyScore) * 100}%` }}
                        />
                      </div>
                      <span className={styles.latencyCaption}>{msToSecondsLabel(avgMs)}</span>
                    </div>
                    <div>
                      <span>P95</span>
                      <div className={styles.latencyMeter}>
                        <div
                          className={styles.latencyP95}
                          style={{ width: `${(p95Ms / latencyScore) * 100}%` }}
                        />
                      </div>
                      <span className={styles.latencyCaption}>{msToSecondsLabel(p95Ms)}</span>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <aside className={styles.eventsColumn}>
            <h3 className={styles.eventsTitle}>Недавние действия</h3>
            {events.length === 0 ? (
              <p className={styles.consoleEmpty}>Пока нет записей.</p>
            ) : (
              <ul className={styles.eventList} aria-label="История действий">
                {events.map((event, idx) => (
                  <li key={idx} className={styles.eventListItem}>
                    {humanEventLine(event)}
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}
