import { useState, useEffect } from 'react'
import { api } from '../api/client'
import styles from './Techniques.module.css'

interface Technique {
  id: string
  name: string
  core_pattern?: string
  why_it_works?: string
  anti_patterns?: string[]
  variants?: { name?: string; pattern?: string; use_when?: string }[]
  compatibility?: { combines_well_with?: string[] }
  good_example?: string
  when_to_use?: { task_types?: string[]; complexity?: string[] }
}

export default function Techniques() {
  const [techniques, setTechniques] = useState<Technique[]>([])
  const [search, setSearch] = useState('')
  const [taskType, setTaskType] = useState('')
  const [complexity, setComplexity] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    api.getTechniques({ search: search || undefined, task_type: taskType || undefined, complexity: complexity || undefined })
      .then((r) => setTechniques(r.techniques as Technique[]))
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [search, taskType, complexity])

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
        <select className={styles.search} value={taskType} onChange={(e) => setTaskType(e.target.value)}>
          <option value="">Все task types</option>
          <option value="code">code</option>
          <option value="analysis">analysis</option>
          <option value="research">research</option>
          <option value="structured_output">structured_output</option>
          <option value="debugging">debugging</option>
          <option value="general">general</option>
        </select>
        <select className={styles.search} value={complexity} onChange={(e) => setComplexity(e.target.value)}>
          <option value="">Все уровни сложности</option>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </select>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {loading ? (
        <p>Загрузка...</p>
      ) : techniques.length === 0 ? (
        <p className={styles.empty}>Техники не найдены</p>
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
              <details className={styles.details}>
                <summary>Подробнее</summary>
                {t.why_it_works && <p><strong>Почему работает:</strong> {t.why_it_works}</p>}
                {t.good_example && <p><strong>Пример:</strong> {t.good_example}</p>}
                {t.compatibility?.combines_well_with?.length ? (
                  <p><strong>Хорошо сочетается с:</strong> {t.compatibility.combines_well_with.join(', ')}</p>
                ) : null}
                {t.anti_patterns?.length ? (
                  <div>
                    <strong>Anti-patterns</strong>
                    <ul>
                      {t.anti_patterns.map((item, idx) => <li key={idx}>{item}</li>)}
                    </ul>
                  </div>
                ) : null}
                {t.variants?.length ? (
                  <div>
                    <strong>Варианты</strong>
                    {t.variants.map((variant, idx) => (
                      <div key={idx} className={styles.variant}>
                        <p><strong>{variant.name || `Вариант ${idx + 1}`}</strong></p>
                        {variant.use_when && <p>{variant.use_when}</p>}
                        {variant.pattern && <pre className={styles.pattern}>{variant.pattern}</pre>}
                      </div>
                    ))}
                  </div>
                ) : null}
                {t.core_pattern && (
                  <button onClick={() => {
                    const blob = new Blob([t.core_pattern || ''], { type: 'text/plain;charset=utf-8' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `${t.id}.txt`
                    a.click()
                    URL.revokeObjectURL(url)
                  }}>
                    Скачать шаблон
                  </button>
                )}
              </details>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
