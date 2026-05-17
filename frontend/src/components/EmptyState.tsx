import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import styles from './EmptyState.module.css'

type Props = {
  title: string
  description?: string
  actionLabel?: string
  actionTo?: string
  onAction?: () => void
  secondaryLabel?: string
  secondaryTo?: string
  children?: ReactNode
  className?: string
}

export default function EmptyState({
  title,
  description,
  actionLabel,
  actionTo,
  onAction,
  secondaryLabel,
  secondaryTo,
  children,
  className,
}: Props) {
  return (
    <div className={`${styles.wrap} ${className ?? ''}`}>
      <h2 className={styles.title}>{title}</h2>
      {description ? <p className={styles.description}>{description}</p> : null}
      {children}
      <div className={styles.actions}>
        {actionLabel && actionTo ? (
          <Link to={actionTo} className={`btn-primary ${styles.primaryBtn}`}>
            {actionLabel}
          </Link>
        ) : null}
        {actionLabel && onAction && !actionTo ? (
          <button type="button" className={`btn-primary ${styles.primaryBtn}`} onClick={onAction}>
            {actionLabel}
          </button>
        ) : null}
        {secondaryLabel && secondaryTo ? (
          <Link to={secondaryTo} className={`btn-ghost ${styles.secondaryBtn}`}>
            {secondaryLabel}
          </Link>
        ) : null}
      </div>
    </div>
  )
}
