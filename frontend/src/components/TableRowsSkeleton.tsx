import styles from './TableRowsSkeleton.module.css'

type Props = {
  rows?: number
  className?: string
}

export default function TableRowsSkeleton({ rows = 5, className }: Props) {
  return (
    <div className={`${styles.wrap} ${className ?? ''}`} aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={styles.row}>
          <div className={`skeleton ${styles.cell}`} />
          <div className={`skeleton ${styles.cellShort}`} />
          <div className={`skeleton ${styles.cellShort}`} />
          <div className={`skeleton ${styles.cellMed}`} />
        </div>
      ))}
    </div>
  )
}
