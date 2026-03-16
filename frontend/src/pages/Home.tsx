import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, type GenerateRequest, type GenerateResult, type LibraryItem, type PromptIdePreviewResponse, type Workspace } from '../api/client'
import styles from './Home.module.css'

const ACTIVE_WORKSPACE_KEY = 'prompt-engineer-active-workspace'
const ACTIVE_SESSION_KEY = 'prompt-engineer-active-prompt-session'

type Technique = { id: string; name: string }

export default function Home() {
  const location = useLocation()
  const navigate = useNavigate()
  const [taskInput, setTaskInput] = useState('')
  const [feedback, setFeedback] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GenerateResult | null>(null)
  const [iterationMode, setIterationMode] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(localStorage.getItem(ACTIVE_SESSION_KEY))

  const [providers, setProviders] = useState<Record<string, string>>({})
  const [targetModels, setTargetModels] = useState<Record<string, string>>({})
  const [domains, setDomains] = useState<{ id: string; name: string }[]>([])
  const [techniques, setTechniques] = useState<Technique[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [genModel, setGenModel] = useState('deepseek')
  const [targetModel, setTargetModel] = useState('unknown')
  const [domain, setDomain] = useState('auto')
  const [techniqueMode, setTechniqueMode] = useState<'auto' | 'manual'>('auto')
  const [manualTechs, setManualTechs] = useState<string[]>([])
  const [temperature, setTemperature] = useState(0.7)
  const [topP, setTopP] = useState(1)
  const [topK, setTopK] = useState<number | ''>('')
  const [questionsMode, setQuestionsMode] = useState(true)
  const [workspaceId, setWorkspaceId] = useState<number>(Number(localStorage.getItem(ACTIVE_WORKSPACE_KEY) || 0))
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [preview, setPreview] = useState<PromptIdePreviewResponse | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [versions, setVersions] = useState<Record<string, unknown>[]>([])
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveTitle, setSaveTitle] = useState('')
  const [saveTags, setSaveTags] = useState('')
  const [saveNotes, setSaveNotes] = useState('')
  const [questionState, setQuestionState] = useState<Record<number, { options: string[]; custom: string }>>({})
  const [ideAudience, setIdeAudience] = useState('')
  const [ideOutputFormat, setIdeOutputFormat] = useState('')
  const [ideSourceOfTruth, setIdeSourceOfTruth] = useState('')
  const [ideSuccessCriteria, setIdeSuccessCriteria] = useState('')
  const [ideConstraints, setIdeConstraints] = useState('')
  const [evidenceDecisions, setEvidenceDecisions] = useState<Record<string, string>>({})
  const [previewSeed, setPreviewSeed] = useState('')

  useEffect(() => {
    api.getProviders().then((r) => setProviders(r.labels))
    api.getTargetModels().then((r) => setTargetModels(r.labels))
    api.getDomains().then((r) => setDomains(r.domains))
    api.getTechniques().then((r) => {
      const items = (r.techniques as Record<string, unknown>[]).map((item) => ({
        id: String(item.id),
        name: String(item.name || item.id),
      }))
      setTechniques(items)
    })
    api.getWorkspaces().then((r) => setWorkspaces(r.items)).catch(() => setWorkspaces([]))
  }, [])

  useEffect(() => {
    const state = location.state as { prefillTask?: string; clearResult?: boolean } | null
    if (state?.prefillTask) {
      setTaskInput(state.prefillTask)
      if (state.clearResult) setResult(null)
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [location.pathname, location.state, navigate])

  useEffect(() => {
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, String(workspaceId))
  }, [workspaceId])

  useEffect(() => {
    if (sessionId) {
      localStorage.setItem(ACTIVE_SESSION_KEY, sessionId)
      api.getSessionVersions(sessionId).then((r) => setVersions(r.items)).catch(() => setVersions([]))
    } else {
      localStorage.removeItem(ACTIVE_SESSION_KEY)
      setVersions([])
    }
  }, [sessionId])

  const ideOverrides = useMemo(
    () => ({
      audience: ideAudience,
      output_format: ideOutputFormat,
      source_of_truth: ideSourceOfTruth.split('\n').map((v) => v.trim()).filter(Boolean),
      success_criteria: ideSuccessCriteria.split('\n').map((v) => v.trim()).filter(Boolean),
      constraints: ideConstraints.split('\n').map((v) => v.trim()).filter(Boolean),
    }),
    [ideAudience, ideOutputFormat, ideSourceOfTruth, ideSuccessCriteria, ideConstraints],
  )

  useEffect(() => {
    const words = taskInput.trim().split(/\s+/).filter(Boolean)
    if (words.length <= 3) {
      setPreview(null)
      return
    }

    const seed = [
      taskInput,
      targetModel,
      workspaceId,
      techniqueMode,
      manualTechs.join(','),
      result?.prompt_block || '',
    ].join('|')

    const timer = window.setTimeout(async () => {
      setPreviewLoading(true)
      try {
        const res = await api.previewPromptIde({
          task_input: taskInput,
          target_model: targetModel,
          workspace_id: workspaceId || null,
          previous_prompt: iterationMode ? result?.prompt_block : undefined,
          technique_mode: techniqueMode,
          manual_techs: manualTechs,
          overrides: ideOverrides,
          evidence_decisions: evidenceDecisions,
        })
        setPreview(res)
        if (previewSeed !== seed) {
          setPreviewSeed(seed)
          setIdeAudience(res.prompt_spec.audience || '')
          setIdeOutputFormat(res.prompt_spec.output_format || '')
          setIdeSourceOfTruth((res.prompt_spec.source_of_truth || []).join('\n'))
          setIdeSuccessCriteria((res.prompt_spec.success_criteria || []).join('\n'))
          setIdeConstraints((res.prompt_spec.constraints || []).join('\n'))
          setEvidenceDecisions({})
        }
      } catch {
        setPreview(null)
      } finally {
        setPreviewLoading(false)
      }
    }, 350)

    return () => window.clearTimeout(timer)
  }, [taskInput, targetModel, workspaceId, techniqueMode, manualTechs, iterationMode, result?.prompt_block, ideOverrides, evidenceDecisions, previewSeed])

  const handleGenerate = async (questionAnswers?: { question: string; answers: string[] }[]) => {
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
        top_p: topP,
        top_k: topK === '' ? undefined : topK,
        questions_mode: questionsMode && !questionAnswers?.length,
        session_id: sessionId || undefined,
        previous_prompt: iterationMode && result ? result.prompt_block : undefined,
        workspace_id: workspaceId || null,
        prompt_spec_overrides: ideOverrides,
        evidence_decisions: evidenceDecisions,
        question_answers: questionAnswers || [],
      }
      const res = await api.generate(req)
      setResult(res)
      setSessionId(res.session_id)
      setIterationMode(false)
      setQuestionState({})
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
    setShowSaveDialog(false)
    setQuestionState({})
  }

  const handleSaveToLibrary = async () => {
    if (!result?.prompt_block) return
    await api.saveToLibrary({
      title: saveTitle || taskInput.slice(0, 60) || 'Без названия',
      prompt: result.prompt_block,
      tags: saveTags.split(',').map((t) => t.trim()).filter(Boolean),
      target_model: result.target_model,
      task_type: result.task_types?.[0] || 'general',
      techniques: result.technique_ids,
      notes: saveNotes,
    })
    setShowSaveDialog(false)
    setSaveNotes('')
    setSaveTags('')
  }

  const taskSummary = preview
    ? `${preview.classification.task_types.join(', ')} · ${preview.classification.complexity}`
    : ''

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
            <label>Workspace</label>
            <select value={workspaceId} onChange={(e) => setWorkspaceId(Number(e.target.value))}>
              <option value={0}>Без workspace</option>
              {workspaces.map((ws) => (
                <option key={ws.id ?? 0} value={ws.id ?? 0}>{ws.name}</option>
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
          {techniqueMode === 'manual' && (
            <div className={styles.fieldWide}>
              <label>Техники</label>
              <select
                multiple
                value={manualTechs}
                onChange={(e) => setManualTechs(Array.from(e.target.selectedOptions).map((o) => o.value))}
                className={styles.multiSelect}
              >
                {techniques.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}
          <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}>
            {showAdvanced ? 'Скрыть' : 'Доп. параметры'}
          </button>
          {showAdvanced && (
            <>
              <div className={styles.field}>
                <label>Температура: {temperature}</label>
                <input type="range" min={0.1} max={1} step={0.1} value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))} />
              </div>
              <div className={styles.field}>
                <label>Top-P: {topP.toFixed(2)}</label>
                <input type="range" min={0} max={1} step={0.05} value={topP} onChange={(e) => setTopP(parseFloat(e.target.value))} />
              </div>
              <div className={styles.field}>
                <label>Top-K</label>
                <input type="number" value={topK} onChange={(e) => setTopK(e.target.value ? Number(e.target.value) : '')} />
              </div>
              <label className={styles.checkboxRow}>
                <input type="checkbox" checked={questionsMode} onChange={(e) => setQuestionsMode(e.target.checked)} />
                Режим уточняющих вопросов
              </label>
            </>
          )}
        </div>
      </details>

      {preview && (
        <div className={styles.previewBar}>
          <span>{taskSummary}</span>
          {preview.techniques.length > 0 && (
            <span>{preview.techniques.map((t) => t.name).join(', ')}</span>
          )}
          {previewLoading && <span>Обновляю IDE preview…</span>}
        </div>
      )}

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
          {preview && (
            <details className={styles.ideBox}>
              <summary>IDE-анализ запроса</summary>
              <div className={styles.ideGrid}>
                <div className={styles.ideSection}>
                  <h3>Spec Editor</h3>
                  <label>
                    Аудитория
                    <input value={ideAudience} onChange={(e) => setIdeAudience(e.target.value)} />
                  </label>
                  <label>
                    Формат вывода
                    <select value={ideOutputFormat} onChange={(e) => setIdeOutputFormat(e.target.value)}>
                      <option value="">Автоопределение</option>
                      <option value="json">json</option>
                      <option value="xml">xml</option>
                      <option value="yaml">yaml</option>
                      <option value="markdown">markdown</option>
                      <option value="table">table</option>
                      <option value="list">list</option>
                    </select>
                  </label>
                  <label>
                    Источник истины
                    <textarea rows={4} value={ideSourceOfTruth} onChange={(e) => setIdeSourceOfTruth(e.target.value)} />
                  </label>
                  <label>
                    Критерии успеха
                    <textarea rows={4} value={ideSuccessCriteria} onChange={(e) => setIdeSuccessCriteria(e.target.value)} />
                  </label>
                  <label>
                    Ограничения
                    <textarea rows={4} value={ideConstraints} onChange={(e) => setIdeConstraints(e.target.value)} />
                  </label>
                </div>
                <div className={styles.ideSection}>
                  <h3>Intent</h3>
                  {(preview.intent_graph || []).map((node) => (
                    <div key={node.id} className={styles.ideItem}>
                      <strong>{node.label}</strong> <span>{node.status} · {node.criticality}</span>
                      {node.value && <p>{node.value}</p>}
                    </div>
                  ))}
                </div>
                <div className={styles.ideSection}>
                  <h3>Debugger</h3>
                  {(preview.debug_issues || []).length === 0 ? (
                    <p className={styles.success}>Критичных структурных проблем не найдено.</p>
                  ) : (
                    (preview.debug_issues || []).map((issue, idx) => (
                      <div key={idx} className={styles.issueCard}>
                        <strong>[{issue.severity.toUpperCase()}] {issue.message}</strong>
                        <p>{issue.why_it_matters}</p>
                        <p>Что сделать: {issue.suggested_fix}</p>
                      </div>
                    ))
                  )}
                </div>
                <div className={styles.ideSection}>
                  <h3>Evidence</h3>
                  {Object.entries(preview.evidence || {}).map(([field, meta]) => (
                    <div key={field} className={styles.evidenceCard}>
                      <strong>{field}</strong>
                      <p>{meta.source_type} ({meta.confidence.toFixed(2)})</p>
                      <p>{meta.reason}</p>
                      {meta.value_preview && <p>{meta.value_preview}</p>}
                      {meta.can_accept_reject && (
                        <div className={styles.evidenceActions}>
                          <button onClick={() => setEvidenceDecisions((prev) => ({ ...prev, [field]: 'accept' }))}>Принять</button>
                          <button onClick={() => setEvidenceDecisions((prev) => ({ ...prev, [field]: 'reject' }))}>Отклонить</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </details>
          )}
          <button
            className={styles.primaryBtn}
            onClick={() => handleGenerate()}
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
              {result.prompt_spec && (
                <details className={styles.resultSection}>
                  <summary>Prompt IDE: spec / debugger / evidence</summary>
                  <div className={styles.ideGrid}>
                    <div className={styles.ideSection}>
                      <h3>Spec</h3>
                      <p><strong>Цель:</strong> {result.prompt_spec.goal || '—'}</p>
                      <p><strong>Типы задач:</strong> {(result.prompt_spec.task_types || []).join(', ') || '—'}</p>
                      <p><strong>Сложность:</strong> {result.prompt_spec.complexity || '—'}</p>
                      <p><strong>Аудитория:</strong> {result.prompt_spec.audience || '—'}</p>
                      <p><strong>Формат вывода:</strong> {result.prompt_spec.output_format || '—'}</p>
                      <p><strong>Источник истины:</strong> {(result.prompt_spec.source_of_truth || []).join('; ') || '—'}</p>
                      <p><strong>Критерии успеха:</strong> {(result.prompt_spec.success_criteria || []).join('; ') || '—'}</p>
                      <p><strong>Ограничения:</strong> {(result.prompt_spec.constraints || []).join('; ') || '—'}</p>
                    </div>
                    <div className={styles.ideSection}>
                      <h3>Debugger</h3>
                      {(result.debug_issues || []).length === 0 ? (
                        <p className={styles.success}>Debugger не нашёл критичных проблем.</p>
                      ) : (
                        (result.debug_issues || []).map((issue, idx) => (
                          <div key={idx} className={styles.issueCard}>
                            <strong>[{issue.severity.toUpperCase()}] {issue.message}</strong>
                            <p>{issue.why_it_matters}</p>
                          </div>
                        ))
                      )}
                    </div>
                    <div className={styles.ideSection}>
                      <h3>Evidence</h3>
                      {Object.entries(result.evidence || {}).map(([field, meta]) => (
                        <div key={field} className={styles.evidenceCard}>
                          <strong>{field}</strong>
                          <p>{meta.source_type} ({meta.confidence.toFixed(2)})</p>
                          <p>{meta.reason}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </details>
              )}
              {result.metrics && (
                <div className={styles.metricsBox}>
                  <h3>Метрики промпта</h3>
                  <div className={styles.metricGrid}>
                    <div><strong>Токены:</strong> {String(result.metrics.token_estimate ?? 0)}</div>
                    <div><strong>Инструкции:</strong> {String(result.metrics.instruction_count ?? 0)}</div>
                    <div><strong>Ограничения:</strong> {String(result.metrics.constraint_count ?? 0)}</div>
                    <div><strong>Completeness:</strong> {String(result.metrics.completeness_score ?? result.metrics.quality_score ?? 0)}%</div>
                  </div>
                  {Array.isArray(result.metrics.improvement_tips) && result.metrics.improvement_tips.length > 0 && (
                    <details>
                      <summary>Советы по улучшению</summary>
                      <ul>
                        {(result.metrics.improvement_tips as string[]).map((tip, idx) => (
                          <li key={idx}>{tip}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
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
                <button onClick={() => navigate('/compare', { state: { taskInput: result.task_input || taskInput } })}>Сравнить</button>
                <button onClick={() => {
                  setSaveTitle(taskInput.slice(0, 60))
                  setShowSaveDialog((v) => !v)
                }}>В библиотеку</button>
              </div>
              {showSaveDialog && (
                <div className={styles.saveBox}>
                  <h3>Сохранить в библиотеку</h3>
                  <input value={saveTitle} onChange={(e) => setSaveTitle(e.target.value)} placeholder="Название" />
                  <input value={saveTags} onChange={(e) => setSaveTags(e.target.value)} placeholder="Теги через запятую" />
                  <textarea value={saveNotes} onChange={(e) => setSaveNotes(e.target.value)} rows={3} placeholder="Заметки" />
                  <div className={styles.actions}>
                    <button onClick={handleSaveToLibrary}>Сохранить</button>
                    <button onClick={() => setShowSaveDialog(false)}>Отмена</button>
                  </div>
                </div>
              )}
              {versions.length > 1 && (
                <details className={styles.resultSection}>
                  <summary>История версий ({versions.length})</summary>
                  <div className={styles.versionList}>
                    {([...versions].reverse()).map((item, idx) => {
                      const v = item as Record<string, unknown>
                      return (
                        <div key={idx} className={styles.versionCard}>
                          <div>
                            <strong>v{String(v.version)}</strong> · {String(v.created_at || '')}
                          </div>
                          <div className={styles.actions}>
                            <button onClick={() => setResult((prev) => prev ? { ...prev, prompt_block: String(v.final_prompt || '') } : prev)}>
                              Загрузить
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </details>
              )}
            </>
          )}
          {result?.has_questions && !result?.has_prompt && (
            <div className={styles.questionBox}>
              <p className={styles.info}>Ответь на вопросы, затем продолжи генерацию.</p>
              {(result.questions || []).map((q, idx) => {
                const state = questionState[idx] || { options: [], custom: '' }
                return (
                  <div key={idx} className={styles.questionItem}>
                    <strong>{idx + 1}. {q.question}</strong>
                    <select
                      multiple
                      value={state.options}
                      onChange={(e) => setQuestionState((prev) => ({
                        ...prev,
                        [idx]: { ...state, options: Array.from(e.target.selectedOptions).map((o) => o.value) },
                      }))}
                      className={styles.multiSelect}
                    >
                      {q.options.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                    <input
                      value={state.custom}
                      placeholder="Свой ответ"
                      onChange={(e) => setQuestionState((prev) => ({
                        ...prev,
                        [idx]: { ...state, custom: e.target.value },
                      }))}
                    />
                  </div>
                )
              })}
              <div className={styles.actions}>
                <button onClick={() => handleGenerate([])}>Пропустить все</button>
                <button
                  className={styles.primaryAction}
                  onClick={() => handleGenerate((result.questions || []).map((q, idx) => ({
                    question: q.question,
                    answers: [
                      ...(questionState[idx]?.options || []),
                      ...((questionState[idx]?.custom || '').trim() ? [questionState[idx].custom.trim()] : []),
                    ],
                  })))}
                >
                  Создать промпт с этими ответами
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
