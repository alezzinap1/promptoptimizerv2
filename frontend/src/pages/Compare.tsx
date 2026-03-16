import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../api/client'
import styles from './Compare.module.css'

export default function Compare() {
  const location = useLocation()
  const [taskInput, setTaskInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ a: { prompt: string; reasoning: string; techniques: { id: string; name: string }[]; metrics: Record<string, unknown> }; b: { prompt: string; reasoning: string; techniques: { id: string; name: string }[]; metrics: Record<string, unknown> }; winner: 'a' | 'b' | 'tie' } | null>(null)
  const [genModel, setGenModel] = useState('deepseek')
  const [targetModel, setTargetModel] = useState('unknown')
  const [providers, setProviders] = useState<Record<string, string>>({})
  const [targetModels, setTargetModels] = useState<Record<string, string>>({})
  const [techniques, setTechniques] = useState<{ id: string; name: string }[]>([])
  const [techsAMode, setTechsAMode] = useState<'auto' | 'manual'>('auto')
  const [techsBMode, setTechsBMode] = useState<'auto' | 'manual'>('auto')
  const [techsAManual, setTechsAManual] = useState<string[]>([])
  const [techsBManual, setTechsBManual] = useState<string[]>([])
  const [temperature, setTemperature] = useState(0.7)
  const [topP, setTopP] = useState(1)

  useEffect(() => {
    const state = location.state as { taskInput?: string } | null
    if (state?.taskInput) setTaskInput(state.taskInput)
    api.getProviders().then((r) => setProviders(r.labels))
    api.getTargetModels().then((r) => setTargetModels(r.labels))
    api.getTechniques().then((r) => setTechniques((r.techniques as Record<string, unknown>[]).map((item) => ({
      id: String(item.id),
      name: String(item.name || item.id),
    }))))
  }, [location.state])

  const handleCompare = async () => {
    if (!taskInput.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.compare({
        task_input: taskInput.trim(),
        gen_model: genModel,
        target_model: targetModel,
        temperature,
        top_p: topP,
        techs_a_mode: techsAMode,
        techs_a_manual: techsAManual,
        techs_b_mode: techsBMode,
        techs_b_manual: techsBManual,
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
        <div className={styles.field}>
          <label>Температура</label>
          <input type="range" min={0.1} max={1} step={0.1} value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))} />
        </div>
        <div className={styles.field}>
          <label>Top-P</label>
          <input type="range" min={0} max={1} step={0.05} value={topP} onChange={(e) => setTopP(parseFloat(e.target.value))} />
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

      <div className={styles.results}>
        <div className={styles.column}>
          <h3>Вариант A</h3>
          <div className={styles.radioRow}>
            <label><input type="radio" checked={techsAMode === 'auto'} onChange={() => setTechsAMode('auto')} /> Авто</label>
            <label><input type="radio" checked={techsAMode === 'manual'} onChange={() => setTechsAMode('manual')} /> Вручную</label>
          </div>
          {techsAMode === 'manual' && (
            <select multiple className={styles.multi} value={techsAManual} onChange={(e) => setTechsAManual(Array.from(e.target.selectedOptions).map((o) => o.value))}>
              {techniques.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
        </div>
        <div className={styles.column}>
          <h3>Вариант B</h3>
          <div className={styles.radioRow}>
            <label><input type="radio" checked={techsBMode === 'auto'} onChange={() => setTechsBMode('auto')} /> Авто</label>
            <label><input type="radio" checked={techsBMode === 'manual'} onChange={() => setTechsBMode('manual')} /> Вручную</label>
          </div>
          {techsBMode === 'manual' && (
            <select multiple className={styles.multi} value={techsBManual} onChange={(e) => setTechsBManual(Array.from(e.target.selectedOptions).map((o) => o.value))}>
              {techniques.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      <button className={styles.primaryBtn} onClick={handleCompare} disabled={!taskInput.trim() || loading}>
        {loading ? 'Генерирую...' : 'Сгенерировать оба варианта'}
      </button>

      {error && <p className={styles.error}>{error}</p>}

      {result && (
        <>
          <div className={styles.winner}>
            {result.winner === 'tie' ? 'Варианты равны по метрикам' : `По метрикам лидирует вариант ${result.winner.toUpperCase()}`}
          </div>
          <div className={styles.metricCompare}>
            <div>Completeness A: {String(result.a.metrics.completeness_score ?? result.a.metrics.quality_score ?? 0)}%</div>
            <div>Completeness B: {String(result.b.metrics.completeness_score ?? result.b.metrics.quality_score ?? 0)}%</div>
            <div>Токены A: {String(result.a.metrics.token_estimate ?? 0)}</div>
            <div>Токены B: {String(result.b.metrics.token_estimate ?? 0)}</div>
          </div>
          <div className={styles.results}>
          <div className={styles.column}>
            <h3>Вариант A</h3>
            <p className={styles.meta}>{result.a.techniques.map((t) => t.name).join(' + ')}</p>
            {result.a.reasoning && (
              <details>
                <summary>Reasoning A</summary>
                <pre className={styles.prompt}>{result.a.reasoning}</pre>
              </details>
            )}
            <textarea className={styles.textarea} value={result.a.prompt} readOnly rows={14} />
            <button onClick={() => {
              const blob = new Blob([result.a.prompt], { type: 'text/plain;charset=utf-8' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = 'prompt_a.txt'
              a.click()
              URL.revokeObjectURL(url)
            }}>Скачать A</button>
          </div>
          <div className={styles.column}>
            <h3>Вариант B</h3>
            <p className={styles.meta}>{result.b.techniques.map((t) => t.name).join(' + ')}</p>
            {result.b.reasoning && (
              <details>
                <summary>Reasoning B</summary>
                <pre className={styles.prompt}>{result.b.reasoning}</pre>
              </details>
            )}
            <textarea className={styles.textarea} value={result.b.prompt} readOnly rows={14} />
            <button onClick={() => {
              const blob = new Blob([result.b.prompt], { type: 'text/plain;charset=utf-8' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = 'prompt_b.txt'
              a.click()
              URL.revokeObjectURL(url)
            }}>Скачать B</button>
          </div>
          </div>
        </>
      )}
    </div>
  )
}
