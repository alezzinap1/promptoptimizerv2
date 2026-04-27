import ThemedTooltip from './ThemedTooltip'
import type { LibraryRevisionSummary } from '../api/client'
import styles from './LibraryRevisionStrip.module.css'

type Props = {
  libraryId: number
  revisions: LibraryRevisionSummary[]
  activeSeq?: number | null
  onPickVersion?: (seq: number) => void
  onStarRevision?: (revisionId: number, isCurrentlyStarred: boolean) => void
  pickMode?: boolean
  className?: string
  /** Подсказка, как появятся v2, v3… */
  showMultiVersionHint?: boolean
}

function sparklinePoints(scores: number[]): { pts: string; w: number; h: number } | null {
  if (scores.length < 2) return null
  const ordered = [...scores].reverse()
  const max = Math.max(100, ...ordered)
  const w = 52
  const h = 12
  const step = w / (ordered.length - 1)
  const pts = ordered.map((s, i) => `${i * step},${h - (s / max) * h}`).join(' ')
  return { pts, w, h }
}

export default function LibraryRevisionStrip({
  libraryId,
  revisions,
  activeSeq,
  onPickVersion,
  onStarRevision,
  pickMode,
  className = '',
  showMultiVersionHint,
}: Props) {
  if (!revisions?.length) return null

  const scores = revisions.map((r) => Number(r.completeness_score ?? 0))
  const spark = sparklinePoints(scores)
  const starTip = 'Пометить версию (избранное). Повторный клик — снять.'

  return (
    <div className={`${styles.ribbon} ${className}`.trim()}>
      <div className={styles.ribbonLeft}>
        <span className={styles.label}>Версии</span>
        <span className={styles.count}>{revisions.length}</span>
        {spark ? (
          <svg className={styles.sparkMini} width={spark.w} height={spark.h} viewBox={`0 0 ${spark.w} ${spark.h}`} aria-hidden>
            <polyline
              points={spark.pts}
              fill="none"
              stroke="var(--primary, #38bdf8)"
              strokeWidth="1.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
        {showMultiVersionHint && revisions.length === 1 ? (
          <span className={styles.singleHint} title="Сохраните снова в ту же карточку с режимом «Добавить новую версию»">
            v2+ — при повторном сохранении
          </span>
        ) : null}
      </div>
      <div className={styles.pills}>
        {revisions.map((r) => {
          const score = Number(r.completeness_score ?? 0)
          const isActive = activeSeq != null && r.version_seq === activeSeq
          const starChar = r.is_starred ? '★' : '☆'
          return (
            <div key={`${libraryId}-${r.id}`} className={styles.pillRow}>
              {onPickVersion ? (
                <button
                  type="button"
                  className={`${styles.pill} ${isActive ? styles.pillActive : ''} ${r.is_starred ? styles.pillStarred : ''}`}
                  onClick={() => onPickVersion(r.version_seq)}
                >
                  <span className={styles.pillNum}>v{r.version_seq}</span>
                  {score > 0 ? <span className={styles.pillScore}>{score}%</span> : null}
                </button>
              ) : (
                <span
                  className={`${styles.pill} ${r.is_starred ? styles.pillStarred : ''}`}
                  style={{ cursor: 'default' }}
                >
                  <span className={styles.pillNum}>v{r.version_seq}</span>
                  {score > 0 ? <span className={styles.pillScore}>{score}%</span> : null}
                </span>
              )}
              {onStarRevision ? (
                <ThemedTooltip content={starTip} side="top" delayMs={180}>
                  <button
                    type="button"
                    className={`${styles.starBtn} ${r.is_starred ? styles.starOn : ''}`}
                    aria-label={r.is_starred ? 'Снять пометку с версии' : 'Пометить версию'}
                    onClick={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      onStarRevision(r.id, r.is_starred)
                    }}
                  >
                    {starChar}
                  </button>
                </ThemedTooltip>
              ) : null}
            </div>
          )
        })}
      </div>
      {pickMode && onPickVersion ? (
        <p className={styles.expandHint}>Нажмите vN — подставится эта версия промпта.</p>
      ) : null}
    </div>
  )
}
