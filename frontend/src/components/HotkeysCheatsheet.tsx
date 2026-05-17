import { useEffect } from 'react'
import { useT } from '../i18n'
import styles from './HotkeysCheatsheet.module.css'

type Props = {
  open: boolean
  onClose: () => void
}

export default function HotkeysCheatsheet({ open, onClose }: Props) {
  const { t } = useT()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const rows = t.studio.hotkeys.rows

  return (
    <div className={styles.root} role="presentation">
      <button type="button" className={styles.backdrop} aria-label={t.studio.hotkeys.close} onClick={onClose} />
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="hotkeys-title">
        <header className={styles.head}>
          <h2 id="hotkeys-title">{t.studio.hotkeys.title}</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label={t.studio.hotkeys.close}>
            ×
          </button>
        </header>
        <ul className={styles.list}>
          {rows.map((row) => (
            <li key={row.keys}>
              <kbd className={styles.kbd}>{row.keys}</kbd>
              <span>{row.desc}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
