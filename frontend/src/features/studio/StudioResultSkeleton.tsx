import styles from '../../pages/Home.module.css'

export function StudioResultSkeleton() {
  return (
    <div className={styles.resultSkeleton} aria-hidden>
      <div className={`skeleton ${styles.resultSkLine}`} />
      <div className={`skeleton ${styles.resultSkLine}`} style={{ width: '92%' }} />
      <div className={`skeleton ${styles.resultSkLine}`} style={{ width: '78%' }} />
      <div className={`skeleton ${styles.resultSkBar}`} />
      <div className={`skeleton ${styles.resultSkBlock}`} />
      <div className={`skeleton ${styles.resultSkBlock}`} style={{ height: 120 }} />
    </div>
  )
}
