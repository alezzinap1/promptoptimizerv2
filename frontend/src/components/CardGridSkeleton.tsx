import styles from './CardGridSkeleton.module.css'

type Props = {
  columns?: 1 | 2 | 3
  count?: number
  className?: string
}

export default function CardGridSkeleton({ columns = 3, count = 6, className }: Props) {
  const colClass =
    columns === 1 ? styles.cols1 : columns === 2 ? styles.cols2 : styles.cols3
  return (
    <div className={`${styles.grid} ${colClass} ${className ?? ''}`} aria-busy="true" aria-live="polite">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.card}>
          <div className={`skeleton ${styles.hero}`} />
          <div className={`skeleton ${styles.line}`} />
          <div className={`skeleton ${styles.lineShort}`} />
        </div>
      ))}
    </div>
  )
}
