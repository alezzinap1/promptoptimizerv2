import { useState } from 'react'
import { api } from '../api/client'

type Props = {
  /** Текущее значение поля. Если пусто — кнопка disabled. */
  getValue: () => string
  /** Куда записать переведённый текст. */
  setValue: (v: string) => void
  kind?: 'prompt' | 'skill' | 'plain'
  /** Если задано — фиксированное направление, иначе auto. */
  direction?: 'ru->en' | 'en->ru' | 'auto'
  compact?: boolean
  title?: string
  disabled?: boolean
}

export default function TranslateButton({
  getValue,
  setValue,
  kind = 'prompt',
  direction = 'auto',
  compact,
  title,
  disabled,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const run = async () => {
    const text = getValue().trim()
    if (!text) return
    setBusy(true)
    setErr(null)
    try {
      const r = await api.translate({ text, direction, kind })
      setValue(r.translated)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка перевода')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy || disabled}
        title={title || 'Перевести RU↔EN (одной кнопкой)'}
        aria-label="Перевести текст"
        style={{
          padding: compact ? '3px 9px' : '5px 12px',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 8,
          background: 'transparent',
          color: 'var(--color-text-secondary, inherit)',
          fontSize: compact ? 11 : 12.5,
          cursor: busy ? 'wait' : 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {busy ? '…' : 'RU⇄EN'}
      </button>
      {err ? (
        <span style={{ color: 'var(--color-text-danger, #f87171)', fontSize: 11, marginLeft: 6 }}>{err}</span>
      ) : null}
    </>
  )
}
