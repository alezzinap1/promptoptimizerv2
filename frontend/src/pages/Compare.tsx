import { useState, useEffect } from 'react'
import { api } from '../api/client'
import styles from './Compare.module.css'

export default function Compare() {
  const [taskInput, setTaskInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ a: { prompt: string; reasoning: string; techniques: unknown[]; metrics: unknown }; b: { prompt: string; reasoning: string; techniques: unknown[]; metrics: unknown } } | null>(null)
  const [genModel, setGenModel] = useState('deepseek')
  const [targetModel, setTargetModel] = useState('unknown')
  const [providers, setProviders] = useState<Record<string, string>>({})
  const [targetModels, setTargetModels] = useState<Record<string, string>>({})

  useEffect(() => {
    api.getProviders().then((r) => setProviders(r.labels))
    api.getTargetModels().then((r) => setTargetModels(r.labels))
  }, [])

  const handleCompare = async () => {
    if (!taskInput.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.compare({
        task_input: taskInput.trim(),
        gen_model: genModel,
        target_model: targetModel,
        temperature: 0.7,
        techs_a_mode: 'auto',
        techs_b_mode: 'auto',
      })
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.compare}>
      <h1>A/B Сравнение техник</h1>
      <p className={styles.subtitle}>Сгенерируй один промпт двумя разными наборами техник и сравни результат</p>

      <div className={styles.settings}>
        <div className={styles.field}>
          <label>Модель генерации</label>
          <select value={genModel} onChange={(e) => setGenModel(e.target.value)}>
            {Object.entries(providers).map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label>Целевая модель</label>
          <select value={targetModel} onChange={(e) => setTargetModel(e.target.value)}>
            {Object.entries(targetModels).map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.field}>
        <label>Задача (одна для обоих вариантов)</label>
        <textarea
          value={taskInput}
          onChange={(e) => setTaskInput(e.target.value)}
          placeholder="Нужен промпт для извлечения ключевых метрик из финансового отчёта..."
          rows={5}
        />
      </div>

      <button className={styles.primaryBtn} onClick={handleCompare} disabled={!taskInput.trim() || loading}>
        {loading ? 'Генерирую...' : 'Сгенерировать оба варианта'}
      </button>

      {error && <p className={styles.error}>{error}</p>}

      {result && (
        <div className={styles.results}>
          <div className={styles.column}>
            <h3>Вариант A</h3>
            <pre className={styles.prompt}>{result.a.prompt}</pre>
          </div>
          <div className={styles.column}>
            <h3>Вариант B</h3>
            <pre className={styles.prompt}>{result.b.prompt}</pre>
          </div>
        </div>
      )}
    </div>
  )
}
