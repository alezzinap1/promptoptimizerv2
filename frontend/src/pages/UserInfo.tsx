import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/AuthContext'
import ProductMetrics from '../components/ProductMetrics'
import styles from './UserInfo.module.css'

function EmailSection() {
  const { user, refresh } = useAuth()
  const [editing, setEditing] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)
  const [emailSuccess, setEmailSuccess] = useState(false)

  const currentEmail = user?.email

  const handleSave = async () => {
    setEmailError(null)
    setEmailSuccess(false)
    if (!emailInput.trim()) return
    setSaving(true)
    try {
      await api.updateEmail(emailInput.trim())
      await refresh()
      setEditing(false)
      setEmailInput('')
      setEmailSuccess(true)
      setTimeout(() => setEmailSuccess(false), 3000)
    } catch (e) {
      setEmailError(e instanceof Error ? e.message : 'Не удалось сохранить email')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className={styles.section}>
      <h2>Электронная почта</h2>
      <div className={styles.emailRow}>
        {currentEmail ? (
          <span className={styles.emailValue}>{currentEmail}</span>
        ) : (
          <span className={styles.emailEmpty}>Не указана</span>
        )}
        <button className={styles.editBtn} onClick={() => { setEditing(!editing); setEmailError(null) }}>
          {currentEmail ? 'Изменить' : 'Добавить'}
        </button>
      </div>
      {editing && (
        <div className={styles.emailForm}>
          <input
            type="email"
            className={styles.emailInput}
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            placeholder="your@email.com"
            autoFocus
          />
          <button className={styles.saveBtn} onClick={handleSave} disabled={saving || !emailInput.trim()}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
          <button className={styles.cancelBtn} onClick={() => { setEditing(false); setEmailInput('') }}>
            Отмена
          </button>
        </div>
      )}
      {emailError && <p className={styles.emailError}>{emailError}</p>}
      {emailSuccess && <p className={styles.emailSuccess}>Email сохранён</p>}
    </section>
  )
}

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

        <EmailSection />

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
