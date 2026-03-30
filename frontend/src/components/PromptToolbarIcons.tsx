import { useState } from 'react'
import styles from './PromptToolbarIcons.module.css'

export function CopyIconButton({
  text,
  title = 'Копировать',
  className,
}: {
  text: string
  title?: string
  className?: string
}) {
  const [done, setDone] = useState(false)
  const handle = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setDone(true)
      setTimeout(() => setDone(false), 1600)
    } catch {
      /* ignore */
    }
  }
  return (
    <button
      type="button"
      className={`${styles.iconBtn} ${className || ''}`}
      onClick={handle}
      title={done ? 'Скопировано' : title}
      aria-label={title}
    >
      {done ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </svg>
      )}
    </button>
  )
}

export function PencilIconButton({
  onClick,
  title = 'Редактировать',
  className,
}: {
  onClick: () => void
  title?: string
  className?: string
}) {
  return (
    <button type="button" className={`${styles.iconBtn} ${className || ''}`} onClick={onClick} title={title} aria-label={title}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        <path d="m15 5 4 4" />
      </svg>
    </button>
  )
}

export function DownloadIconButton({
  onClick,
  title = 'Скачать',
  className,
}: {
  onClick: () => void
  title?: string
  className?: string
}) {
  return (
    <button type="button" className={`${styles.iconBtn} ${className || ''}`} onClick={onClick} title={title} aria-label={title}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" x2="12" y1="15" y2="3" />
      </svg>
    </button>
  )
}

export function TryInGeminiButton({
  prompt,
  title = 'Скопировать промпт и открыть Gemini',
  className,
}: {
  prompt: string
  title?: string
  className?: string
}) {
  const handle = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
    } catch {
      /* ignore — пользователь может вставить вручную */
    }
    window.open('https://gemini.google.com/app', '_blank', 'noopener')
  }
  return (
    <button
      type="button"
      className={`${styles.iconBtn} ${styles.gemini} ${className || ''}`}
      onClick={() => void handle()}
      title={`${title}. Сайт не принимает текст из ссылки — промпт копируется в буфер, вставьте Ctrl+V в поле чата.`}
      aria-label={title}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    </button>
  )
}

export function TrashIconButton({
  onClick,
  title = 'Удалить',
  className,
}: {
  onClick: () => void
  title?: string
  className?: string
}) {
  return (
    <button type="button" className={`${styles.iconBtn} ${styles.danger} ${className || ''}`} onClick={onClick} title={title} aria-label={title}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 6h18" />
        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
        <line x1="10" x2="10" y1="11" y2="17" />
        <line x1="14" x2="14" y1="11" y2="17" />
      </svg>
    </button>
  )
}
