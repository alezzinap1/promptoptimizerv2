import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

const STORAGE_KEY = 'home_onboarding_visit_count'
const DISMISS_KEY = 'home_onboarding_dismissed'
const MAX_VISITS = 8

export default function HomeOnboardingHints() {
  const [dismissed, setDismissed] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem(DISMISS_KEY) === '1',
  )
  const [visits, setVisits] = useState(0)

  useEffect(() => {
    if (typeof localStorage === 'undefined') return
    if (localStorage.getItem(DISMISS_KEY) === '1') {
      setDismissed(true)
      return
    }
    const raw = localStorage.getItem(STORAGE_KEY)
    const prev = raw ? parseInt(raw, 10) : 0
    const n = Number.isFinite(prev) ? prev : 0
    const next = n + 1
    localStorage.setItem(STORAGE_KEY, String(next))
    setVisits(next)
  }, [])

  if (dismissed || visits > MAX_VISITS || visits === 0) return null

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  return (
    <div
      style={{
        marginBottom: 12,
        padding: '12px 14px',
        borderRadius: 10,
        border: '1px solid rgba(255,255,255,0.12)',
        background: 'rgba(0,0,0,0.2)',
        fontSize: 14,
        lineHeight: 1.45,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div>
          <strong>С чего начать:</strong> опиши задачу слева → сгенерируй промпт → при необходимости сохрани в{' '}
          <Link to="/library">библиотеку</Link>. Ключ OpenRouter — в <Link to="/settings">настройках</Link>, лимиты
          trial — на <Link to="/user-info">странице профиля</Link>. Подробнее в <Link to="/help">справке</Link>.
        </div>
        <button type="button" onClick={dismiss} style={{ flexShrink: 0 }}>
          Не показывать
        </button>
      </div>
    </div>
  )
}
