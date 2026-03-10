import { useState, useEffect } from 'react'
import { api, GenerateRequest, GenerateResult } from '../api/client'
import styles from './Home.module.css'

export default function Home() {
  const [taskInput, setTaskInput] = useState('')
  const [feedback, setFeedback] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GenerateResult | null>(null)
  const [iterationMode, setIterationMode] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)

  const [providers, setProviders] = useState<Record<string, string>>({})
  const [targetModels, setTargetModels] = useState<Record<string, string>>({})
  const [domains, setDomains] = useState<{ id: string; name: string }[]>([])
  const [genModel, setGenModel] = useState('deepseek')
  const [targetModel, setTargetModel] = useState('unknown')
  const [domain, setDomain] = useState('auto')
  const [techniqueMode, setTechniqueMode] = useState<'auto' | 'manual'>('auto')
  const [manualTechs, setManualTechs] = useState<string[]>([])
  const [temperature, setTemperature] = useState(0.7)
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    api.getProviders().then((r) => setProviders(r.labels))
    api.getTargetModels().then((r) => setTargetModels(r.labels))
    api.getDomains().then((r) => setDomains(r.domains))
  }, [])

  const handleGenerate = async () => {
    if (!taskInput.trim()) return
    setLoading(true)
    setError(null)
    try {
      const req: GenerateRequest = {
        task_input: taskInput.trim(),
        feedback: iterationMode ? feedback : '',
        gen_model: genModel,
        target_model: targetModel,
        domain,
        technique_mode: techniqueMode,
        manual_techs: techniqueMode === 'manual' ? manualTechs : [],
        temperature,
        top_p: 1.0,
        questions_mode: true,
        session_id: sessionId || undefined,
        previous_prompt: iterationMode && result ? result.prompt_block : undefined,
      }
      const res = await api.generate(req)
      setResult(res)
      setSessionId(res.session_id)
      setIterationMode(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка генерации')
    } finally {
      setLoading(false)
    }
  }

  const handleNewSession = () => {
    setResult(null)
    setSessionId(null)
    setIterationMode(false)
  }

  return (
    <div className={styles.home}>
      <h1>Prompt Engineer</h1>

      <details className={styles.expander} open>
        <summary>Генерация</summary>
        <div className={styles.controls}>
          <div className={styles.field}>
            <label>Модель для генерации</label>
            <select value={genModel} onChange={(e) => setGenModel(e.target.value)}>
              {Object.entries(providers).map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label>Целевая модель промпта</label>
            <select value={targetModel} onChange={(e) => setTargetModel(e.target.value)}>
              {Object.entries(targetModels).map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label>Шаблон домена</label>
            <select value={domain} onChange={(e) => setDomain(e.target.value)}>
              {domains.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
          <div className={styles.field}>
            <label>Режим техник</label>
            <div className={styles.radioRow}>
              <label><input type="radio" checked={techniqueMode === 'auto'} onChange={() => setTechniqueMode('auto')} /> Авто</label>
              <label><input type="radio" checked={techniqueMode === 'manual'} onChange={() => setTechniqueMode('manual')} /> Вручную</label>
            </div>
          </div>
          <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}>
            {showAdvanced ? 'Скрыть' : 'Доп. параметры'}
          </button>
          {showAdvanced && (
            <div className={styles.field}>
              <label>Температура: {temperature}</label>
              <input type="range" min={0.1} max={1} step={0.1} value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))} />
            </div>
          )}
        </div>
      </details>

      <div className={styles.columns}>
        <div className={styles.left}>
          {iterationMode ? (
            <>
              <h2>Итерация</h2>
              <p className={styles.info}>Опиши что нужно изменить в текущем промпте.</p>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Добавить few-shot примеры, сократить на 30%..."
                rows={4}
              />
            </>
          ) : (
            <>
              <h2>Задача</h2>
              <textarea
                value={taskInput}
                onChange={(e) => setTaskInput(e.target.value)}
                placeholder="Примеры:&#10;• Нужен промпт для анализа финансовых отчётов в JSON формате&#10;• Улучши этот промпт: [вставь свой промпт]"
                rows={8}
              />
            </>
          )}
          <button
            className={styles.primaryBtn}
            onClick={handleGenerate}
            disabled={!taskInput.trim() || loading}
          >
            {loading ? 'Генерирую...' : iterationMode ? 'Обновить промпт' : 'Создать промпт'}
          </button>
          <button type="button" onClick={handleNewSession}>Новая сессия</button>
        </div>

        <div className={styles.right}>
          <h2>Результат</h2>
          {error && <p className={styles.error}>{error}</p>}
          {!result && !error && (
            <p className={styles.empty}>Опиши задачу слева и нажми <strong>Создать промпт</strong></p>
          )}
          {result?.has_prompt && (
            <>
              <textarea
                className={styles.resultPrompt}
                value={result.prompt_block}
                readOnly
                rows={12}
              />
              {result.reasoning && (
                <details>
                  <summary>Почему именно эти техники?</summary>
                  <pre className={styles.reasoning}>{result.reasoning}</pre>
                </details>
              )}
              <div className={styles.actions}>
                <button
                  onClick={() => {
                    const blob = new Blob([result.prompt_block], { type: 'text/plain;charset=utf-8' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = 'prompt.txt'
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                >
                  Скачать .txt
                </button>
                <button onClick={() => setIterationMode(true)}>Итерировать</button>
              </div>
            </>
          )}
          {result?.has_questions && !result?.has_prompt && (
            <p className={styles.info}>Агент задал уточняющие вопросы. (Реализация Q&A — в разработке)</p>
          )}
        </div>
      </div>
    </div>
  )
}
