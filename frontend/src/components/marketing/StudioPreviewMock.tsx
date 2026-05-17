import { useT } from '../../i18n'
import styles from './StudioPreviewMock.module.css'

/** Static Studio composer preview for landing hero (spec §5.2). */
export default function StudioPreviewMock() {
  const { t } = useT()
  return (
    <div className={styles.wrap} aria-hidden>
      <div className={styles.card}>
        <div className={styles.top}>
          <span className={styles.dot} />
          <span className={styles.title}>{t.landing.preview.title}</span>
          <span className={styles.tier}>{t.landing.preview.tierTag}</span>
        </div>
        <div className={styles.chat}>
          <div className={styles.bubbleUser}>{t.landing.preview.userLine}</div>
          <div className={styles.bubbleAssist}>
            <span className={styles.section}># РОЛЬ</span>
            <span>{t.landing.preview.roleLine}</span>
            <span className={styles.section}># ЗАДАЧА</span>
            <span>{t.landing.preview.taskLine}</span>
          </div>
        </div>
        <div className={styles.composer}>
          <span className={styles.placeholder}>{t.landing.preview.composerPlaceholder}</span>
          <span className={styles.send}>↑</span>
        </div>
      </div>
      <span className={styles.floatTag}>{t.landing.preview.floatTag}</span>
    </div>
  )
}
