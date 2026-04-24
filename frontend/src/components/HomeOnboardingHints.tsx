import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'

/** «Не показывать больше» — полный отказ от цепочки онбординга */
const DISMISS_FOREVER_KEY = 'home_onboarding_dismissed'
/** Один раз показали краткую цепочку студии (задача → промпт → библиотека) */
const WELCOME_ACK_KEY = 'home_onboarding_welcome_modal_done'
/** Верхний баннер «Студия — главный режим»; модалку показываем после него, чтобы не дублировать */
const FIRST_HOME_BANNER_KEY = 'metaprompt-home-tip-v1-dismissed'

const OPEN_DELAY_MS = 900

function readBlocked(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return (
      localStorage.getItem(DISMISS_FOREVER_KEY) === '1' || localStorage.getItem(WELCOME_ACK_KEY) === '1'
    )
  } catch {
    return false
  }
}

export default function HomeOnboardingHints() {
  const [blocked, setBlocked] = useState(readBlocked)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (typeof localStorage === 'undefined') return
    try {
      if (localStorage.getItem(DISMISS_FOREVER_KEY) === '1' || localStorage.getItem(WELCOME_ACK_KEY) === '1') {
        setBlocked(true)
      }
    } catch {
      setBlocked(true)
    }
  }, [])

  useEffect(() => {
    if (blocked || typeof window === 'undefined') return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let scheduleStarted = false

    const scheduleOpen = () => {
      if (cancelled || scheduleStarted) return
      scheduleStarted = true
      timer = window.setTimeout(() => {
        if (!cancelled) setOpen(true)
      }, OPEN_DELAY_MS)
    }

    const bannerDismissed = () => {
      try {
        return localStorage.getItem(FIRST_HOME_BANNER_KEY) === '1'
      } catch {
        return false
      }
    }

    if (bannerDismissed()) {
      scheduleOpen()
    } else {
      const onBannerGone = () => {
        if (cancelled) return
        scheduleOpen()
      }
      window.addEventListener('metaprompt-first-home-tip-dismissed', onBannerGone)
      return () => {
        cancelled = true
        if (timer !== undefined) window.clearTimeout(timer)
        window.removeEventListener('metaprompt-first-home-tip-dismissed', onBannerGone)
      }
    }

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [blocked])

  const acknowledge = () => {
    try {
      localStorage.setItem(WELCOME_ACK_KEY, '1')
    } catch {
      /* ignore */
    }
    setBlocked(true)
    setOpen(false)
  }

  const dismissForever = () => {
    try {
      localStorage.setItem(DISMISS_FOREVER_KEY, '1')
      localStorage.setItem(WELCOME_ACK_KEY, '1')
    } catch {
      /* ignore */
    }
    setBlocked(true)
    setOpen(false)
  }

  const closeThisTime = () => {
    acknowledge()
  }

  if (blocked || !open) return null

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
          <strong>С чего начать в студии:</strong> опишите задачу слева → сгенерируйте промпт → при необходимости
          сохраните в{' '}
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
