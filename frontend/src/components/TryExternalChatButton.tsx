import { useRef, useState } from 'react'
import PortalDropdown from './PortalDropdown'
import menuStyles from './DropdownMenu.module.css'
import {
  EXTERNAL_CHAT_PROVIDERS,
  copyPromptAndOpenExternalChat,
  type ExternalChatProviderId,
} from '../lib/externalChatProviders'
import styles from './TryExternalChatButton.module.css'

type Props = {
  prompt: string
  /** Подсказка на кнопке */
  title?: string
  className?: string
}

/**
 * Копирует промпт в буфер и открывает выбранный чат (ChatGPT, Claude, Grok, Gemini).
 * Вставка текста в поле чужого сайта программно невозможна — полный текст всегда в буфере (Ctrl+V).
 */
export function TryExternalChatButton({ prompt, title, className }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  const disabled = !prompt?.trim()

  const pick = async (id: ExternalChatProviderId) => {
    setOpen(false)
    await copyPromptAndOpenExternalChat(id, prompt)
  }

  const defaultTitle =
    'Скопировать промпт и открыть чат. Выберите сервис. Полный текст в буфере — вставьте Ctrl+V в поле чата, если сайт не подставил запрос из ссылки.'

  return (
    <div className={styles.wrap}>
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        className={`${styles.trigger} ${className || ''}`}
        onClick={() => setOpen((v) => !v)}
        title={title ?? defaultTitle}
        aria-label="Открыть промпт во внешнем чате ИИ"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className={styles.triggerIcon} aria-hidden>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </span>
        <span className={styles.triggerLabel}>В чат</span>
        <span className={styles.triggerChev} aria-hidden>
          ▾
        </span>
      </button>
      <PortalDropdown open={open} onClose={() => setOpen(false)} anchorRef={ref} minWidth={220}>
        <div className={styles.menuHint} role="note">
          Текст копируется в буфер; откроется сайт выбранного ИИ.
        </div>
        {EXTERNAL_CHAT_PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={menuStyles.menuItem}
            onClick={() => void pick(p.id)}
          >
            <span className={styles.menuRow}>
              <span>{p.label}</span>
              {p.clipboardPrimary ? (
                <span className={styles.menuBadge}>вставка Ctrl+V</span>
              ) : null}
            </span>
          </button>
        ))}
      </PortalDropdown>
    </div>
  )
}
