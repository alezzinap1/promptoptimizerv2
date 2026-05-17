import styles from './AppRouteSkeleton.module.css'

export default function AppRouteSkeleton() {
  return (
    <div className={styles.wrap} aria-busy="true" aria-live="polite">
      <div className={`skeleton ${styles.title}`} />
      <div className={styles.panel}>
        <div className={`skeleton ${styles.line}`} />
        <div className={`skeleton ${styles.line}`} />
        <div className={`skeleton ${styles.lineShort}`} />
      </div>
      <div className={styles.panel}>
        <div className={`skeleton ${styles.block}`} />
      </div>
    </div>
  )
}
