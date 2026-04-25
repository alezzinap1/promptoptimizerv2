import { useMemo } from 'react'
import { computeRefinedLineDiffOps } from '../lib/lineDiffLcs'
import styles from './SimpleLineDiff.module.css'

type Props = {
  before: string
  after: string
}

/** Построчное сравнение (LCS): удаления / добавления / без изменений */
export default function SimpleLineDiff({ before, after }: Props) {
  const ops = useMemo(() => computeRefinedLineDiffOps(before, after), [before, after])

  return (
    <div className={styles.root} role="region" aria-label="Построчное сравнение">
      {ops.map((op, i) => (
        <div
          key={i}
          className={
            op.kind === 'eq' ? styles.rowEq : op.kind === 'del' ? styles.rowDel : styles.rowIns
          }
        >
          <span className={styles.mark} aria-hidden>
            {op.kind === 'eq' ? ' ' : op.kind === 'del' ? '−' : '+'}
          </span>
          <pre className={styles.line}>{op.text}</pre>
        </div>
      ))}
    </div>
  )
}
