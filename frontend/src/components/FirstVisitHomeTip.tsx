import { useState } from 'react'
import { Link } from 'react-router-dom'
import styles from './FirstVisitHomeTip.module.css'

const STORAGE_KEY = 'metaprompt-home-tip-v1-dismissed'

/**
 * Одноразовая подсказка после входа на Home: чем Studio отличается от Simple.
 */
export default function FirstVisitHomeTip() {
  const [visible, setVisible] = useState(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) !== '1'
    } catch {
      return true
    }
  })

  if (!visible) return null

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      /* ignore */
    }
    setVisible(false)
  }

  return (
    <div className={styles.banner} role="region" aria-label="Краткий обзор режимов">
      <div className={styles.inner}>
        <p className={styles.title}>Студия — главный режим</p>
        <p className={styles.lead}>
          MetaPrompt собирает из вашей задачи структурированный промпт с техниками и версиями — это не просто чат с
          моделью.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>Студия (эта страница):</strong> классификация задачи, подбор техник из базы, разбор в Prompt IDE,
            уточняющие вопросы — полный контур MetaPrompt.
          </li>
          <li>
            <strong>Простой режим</strong> (<Link to="/simple">/simple</Link>): быстро улучшить уже готовый текст промпта
            пресетами, <em>без</em> YAML-техник и IDE — см.{' '}
            <Link to="/help">справку</Link>.
          </li>
        </ul>
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={dismiss}>
            Понятно
          </button>
          <Link to="/help" className={styles.link}>
            Полная справка
          </Link>
        </div>
      </div>
    </div>
  )
}
