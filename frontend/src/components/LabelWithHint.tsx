import type { ReactNode } from 'react'
import styles from './LabelWithHint.module.css'

type Props = {
  label: ReactNode
  hint?: string
  children?: React.ReactNode
  className?: string
}

/** Лейбл с иконкой подсказки (title) и опциональным слотом справа */
export default function LabelWithHint({ label, hint, children, className }: Props) {
  return (
    <div className={`${styles.wrap} ${className || ''}`.trim()}>
      <span className={styles.labelRow}>
        <span className={styles.labelText}>{label}</span>
        {hint ? (
          <button type="button" className={styles.hintBtn} title={hint} aria-label={hint}>
            ?
          </button>
        ) : null}
      </span>
      {children}
    </div>
  )
}
