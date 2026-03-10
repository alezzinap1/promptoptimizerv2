import { useState, useEffect } from 'react'
import { api } from '../api/client'
import styles from './Techniques.module.css'

interface Technique {
  id: string
  name: string
  core_pattern?: string
  when_to_use?: { task_types?: string[]; complexity?: string[] }
}

export default function Techniques() {
  const [techniques, setTechniques] = useState<Technique[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.getTechniques({ search: search || undefined })
      .then((r) => setTechniques(r.techniques as Technique[]))
      .finally(() => setLoading(false))
  }, [search])

  return (
    <div className={styles.techniques}>
      <h1>База знаний техник промптинга</h1>

      <div className={styles.toolbar}>
        <input
          type="search"
          placeholder="Поиск: chain of thought, роль..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={styles.search}
        />
      </div>

      {loading ? (
        <p>Загрузка...</p>
      ) : (
        <div className={styles.grid}>
          {techniques.map((t) => (
            <div key={t.id} className={styles.card}>
              <h3>{t.name || t.id}</h3>
              {t.when_to_use?.task_types && (
                <p className={styles.meta}>{t.when_to_use.task_types.join(', ')}</p>
              )}
              {t.core_pattern && (
                <pre className={styles.pattern}>{t.core_pattern.slice(0, 150)}...</pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
