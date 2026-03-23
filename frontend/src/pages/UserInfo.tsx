import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import ProductMetrics from '../components/ProductMetrics'
import styles from './UserInfo.module.css'

export default function UserInfo() {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.getUserInfo>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getUserInfo()
      .then(setInfo)
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (loading || !info) return
    const h = window.location.hash.replace(/^#/, '')
    if (h === 'product-metrics') {
      requestAnimationFrame(() => {
        document.getElementById('product-metrics')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    }
  }, [loading, info])

  if (loading) return <p className={styles.loading}>Загрузка…</p>
  if (error) return <p className={styles.error}>{error}</p>
  if (!info) return null

  const { tokens_used, dollars_used, has_own_api_key, trial_tokens_remaining, trial_tokens_limit, service_info } = info

  return (
    <>
      <div className={styles.page}>
        <h1>User Info</h1>

        <section className={styles.section}>
          <h2>Использование</h2>
          <div className={styles.stats}>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Токенов</span>
              <span className={styles.statValue}>{tokens_used.toLocaleString()}</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statLabel}>Стоимость</span>
              <span className={styles.statValue}>${dollars_used.toFixed(4)}</span>
            </div>
            {!has_own_api_key && trial_tokens_remaining !== null && (
              <div className={styles.stat}>
                <span className={styles.statLabel}>Пробных токенов осталось</span>
                <span className={styles.statValue}>
                  {trial_tokens_remaining.toLocaleString()} / {trial_tokens_limit.toLocaleString()}
                </span>
              </div>
            )}
          </div>
          {!has_own_api_key && (
            <p className={styles.trialHint}>
              Вы используете пробный режим. Введите свой API ключ OpenRouter в{' '}
              <Link to="/settings">Настройках</Link> для доступа ко всем моделям и снятия лимита.
            </p>
          )}
        </section>

        <section className={styles.section}>
          <h2>О сервисе</h2>
          <p className={styles.description}>{service_info.description}</p>
          <ul className={styles.features}>
            {service_info.features.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </section>
      </div>

      <div className={styles.metricsWide}>
        <ProductMetrics />
      </div>
    </>
  )
}
