import { useCallback, useMemo, useRef } from 'react'
import { getTagAccent, setTagAccent } from '../lib/tagAccentColors'
import styles from './LibraryTagChips.module.css'

type Props = {
  tags: string[]
  className?: string
}

export default function LibraryTagChips({ tags, className = '' }: Props) {
  const colorInputRef = useRef<HTMLInputElement>(null)
  const pendingTagRef = useRef<string | null>(null)

  const openPicker = useCallback((tag: string) => {
    pendingTagRef.current = tag.trim().toLowerCase()
    const cur = getTagAccent(tag)
    const el = colorInputRef.current
    if (el) {
      el.value = cur && /^#[0-9A-Fa-f]{6}$/.test(cur) ? cur : '#64748b'
      el.click()
    }
  }, [])

  const onColorChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const tag = pendingTagRef.current
    if (!tag) return
    setTagAccent(tag, e.target.value)
    pendingTagRef.current = null
  }, [])

  const list = useMemo(() => tags.map((t) => t.trim()).filter(Boolean), [tags])
  if (list.length === 0) return null

  return (
    <div className={`${styles.row} ${className}`.trim()}>
      <input
        ref={colorInputRef}
        type="color"
        className={styles.colorPick}
        aria-hidden
        tabIndex={-1}
        onChange={onColorChange}
      />
      {list.map((tag) => {
        const accent = getTagAccent(tag)
        return (
          <button
            key={tag}
            type="button"
            className={styles.chip}
            title="Нажмите, чтобы задать цвет тега"
            style={
              accent
                ? {
                    borderColor: accent,
                    color: accent,
                  }
                : undefined
            }
            onClick={() => openPicker(tag)}
          >
            {tag}
          </button>
        )
      })}
    </div>
  )
}
