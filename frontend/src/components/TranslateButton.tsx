import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import ThemedTooltip from './ThemedTooltip'

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
  /** Смена ключа сбрасывает кэш пары (например id сессии / карточки). */
  cacheResetKey?: string | number
}

export default function TranslateButton({
  getValue,
  setValue,
  kind = 'prompt',
  direction = 'auto',
  compact,
  title,
  disabled,
  cacheResetKey,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  /** Исходник до перевода и результат API — переключение без второго запроса. */
  const [pair, setPair] = useState<{ source: string; translated: string } | null>(null)

  useEffect(() => {
    setPair(null)
  }, [cacheResetKey])

  const run = async () => {
    const text = getValue().trim()
    if (!text) return
    setErr(null)

    if (pair) {
      if (text === pair.translated) {
        setValue(pair.source)
        return
      }
      if (text === pair.source) {
        setValue(pair.translated)
        return
      }
    }

    setBusy(true)
    try {
      const r = await api.translate({ text, direction, kind })
      const out = (r.translated || '').trim()
      setPair({ source: text, translated: out })
      setValue(out)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка перевода')
    } finally {
      setBusy(false)
    }
  }

  const canToggle = Boolean(
    pair && (getValue().trim() === pair.source || getValue().trim() === pair.translated),
  )

  const tip = useMemo(
    () =>
      title
        ? `${title}${canToggle ? ' (повторное нажатие — вернуть другой язык без нового перевода)' : ''}`
        : canToggle
          ? 'Переключить RU/EN (из кэша, без запроса)'
          : 'Перевести RU↔EN (одной кнопкой)',
    [title, canToggle],
  )

  return (
    <>
      <ThemedTooltip content={tip} side="top" delayMs={280} disabled={busy || Boolean(disabled)}>
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || disabled}
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
      </ThemedTooltip>
      {err ? (
        <span style={{ color: 'var(--color-text-danger, #f87171)', fontSize: 11, marginLeft: 6 }}>{err}</span>
      ) : null}
    </>
  )
}
