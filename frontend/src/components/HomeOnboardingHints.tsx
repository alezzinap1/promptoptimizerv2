import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'

const STORAGE_KEY = 'home_onboarding_visit_count'
const DISMISS_KEY = 'home_onboarding_dismissed'
const MAX_VISITS = 8

export default function HomeOnboardingHints() {
  const [dismissed, setDismissed] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem(DISMISS_KEY) === '1',
  )
  const [visits, setVisits] = useState(0)
  const [open, setOpen] = useState(false)

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

  useEffect(() => {
    if (dismissed || visits > MAX_VISITS || visits === 0) return
    setOpen(true)
  }, [dismissed, visits])

  if (dismissed || visits > MAX_VISITS || visits === 0 || !open) return null

  const dismissForever = () => {
    localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
    setOpen(false)
  }

  const closeThisTime = () => {
    setOpen(false)
  }

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="home-onboarding-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10050,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(4px)',
      }}
      onClick={closeThisTime}
    >
      <div
        style={{
          maxWidth: 440,
          width: '100%',
          borderRadius: 14,
          padding: '20px 22px',
          border: '1px solid rgba(255,255,255,0.14)',
          background: 'var(--surface-elevated, rgba(22,24,32,0.98))',
          boxShadow: '0 24px 48px rgba(0,0,0,0.45)',
          fontSize: 14,
          lineHeight: 1.5,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="home-onboarding-title" style={{ margin: '0 0 12px', fontSize: 17, fontWeight: 700 }}>
          Подсказка
        </h2>
        <p style={{ margin: '0 0 16px', opacity: 0.92 }}>
          <strong>С чего начать:</strong> опиши задачу слева → сгенерируй промпт → при необходимости сохрани в{' '}
          <Link to="/library" onClick={closeThisTime}>
            библиотеку
          </Link>
          . Ключ OpenRouter — в{' '}
          <Link to="/settings" onClick={closeThisTime}>
            настройках
          </Link>
          , лимиты trial — на{' '}
          <Link to="/user-info" onClick={closeThisTime}>
            странице профиля
          </Link>
          . Подробнее в{' '}
          <Link to="/help" onClick={closeThisTime}>
            справке
          </Link>
          .
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" onClick={dismissForever}>
            Не показывать больше
          </button>
          <button type="button" onClick={closeThisTime} style={{ fontWeight: 600 }}>
            Понятно
          </button>
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(modal, document.body)
}
