import type { ReactNode } from 'react'
import ThemedTooltip from './ThemedTooltip'
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
          <ThemedTooltip content={hint} side="top">
            <button type="button" className={styles.hintBtn} aria-label={hint}>
              ?
            </button>
          </ThemedTooltip>
        ) : null}
      </span>
      {children}
    </div>
  )
}
