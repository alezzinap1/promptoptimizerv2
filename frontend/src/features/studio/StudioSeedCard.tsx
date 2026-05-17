import { STUDIO_SEED_PROMPT_BLOCK, STUDIO_SEED_TASK } from '../../lib/studioSeedExample'
import styles from '../../pages/Home.module.css'

type Props = {
  onLoad: (task: string) => void
}

export function StudioSeedCard({ onLoad }: Props) {
  return (
    <div className={styles.seedCard}>
      <p className={styles.seedEyebrow}>Пример</p>
      <p className={styles.seedTitle}>Так будет выглядеть результат</p>
      <pre className={styles.seedPreview}>{STUDIO_SEED_PROMPT_BLOCK.slice(0, 280)}…</pre>
      <button type="button" className="btn-secondary" onClick={() => onLoad(STUDIO_SEED_TASK)}>
        Загрузить этот пример
      </button>
    </div>
  )
}
