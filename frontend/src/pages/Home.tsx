import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  api,
  type GenerateRequest,
  type GenerateResult,
  type GenerationIssue,
  type OpenRouterModel,
  type PromptIdePreviewResponse,
  type Workspace,
} from '../api/client'
import AutoTextarea from '../components/AutoTextarea'
import { CopyIconButton } from '../components/PromptToolbarIcons'
import checkboxList from '../styles/CheckboxOptionList.module.css'
import cb from '../styles/ComposerBar.module.css'
import styles from './Home.module.css'

const ACTIVE_WORKSPACE_KEY = 'prompt-engineer-active-workspace'
const ACTIVE_SESSION_KEY = 'prompt-engineer-active-prompt-session'
const HOME_SPLIT_KEY = 'prompt-engineer-home-split'
/** Минимальная доля ширины на колонку (0–1) */
const MIN_COL_FRAC = 0.14
const DEFAULT_SPLIT_A = 0.33
const DEFAULT_SPLIT_B = 0.66

function clampSplit(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function loadHomeSplits(): { splitA: number; splitB: number } {
  try {
    const raw = localStorage.getItem(HOME_SPLIT_KEY)
    if (raw) {
      const o = JSON.parse(raw) as { splitA?: number; splitB?: number }
      if (typeof o.splitA === 'number' && typeof o.splitB === 'number') {
        let a = o.splitA
        let b = o.splitB
        a = clampSplit(a, MIN_COL_FRAC, 1 - 2 * MIN_COL_FRAC)
        b = clampSplit(b, a + MIN_COL_FRAC, 1 - MIN_COL_FRAC)
        return { splitA: a, splitB: b }
      }
    }
  } catch {
    /* ignore */
  }
  return { splitA: DEFAULT_SPLIT_A, splitB: DEFAULT_SPLIT_B }
}

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

  const [modelLabels, setModelLabels] = useState<Record<string, string>>({ unknown: 'Неизвестно / Любая модель' })
  const [generationOptions, setGenerationOptions] = useState<string[]>([])
  const [techniques, setTechniques] = useState<Technique[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [genModel, setGenModel] = useState('')
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
  const [ideTab, setIdeTab] = useState<'spec' | 'intent' | 'issues' | 'evidence'>('spec')
  const [showIdeModal, setShowIdeModal] = useState(false)
  const [modelsData, setModelsData] = useState<OpenRouterModel[]>([])
  const [splits, setSplits] = useState(() => loadHomeSplits())
  const splitRootRef = useRef<HTMLDivElement>(null)
  const [issueBannerDismissed, setIssueBannerDismissed] = useState(false)
  const lastQuestionAnswersRef = useRef<{ question: string; answers: string[] }[] | undefined>(undefined)

  const GENERATION_ISSUE_TEXT: Record<GenerationIssue, string> = {
    format_failure:
      'Ответ модели не удалось разобрать: нет распознаваемых блоков [PROMPT] и [QUESTIONS]. Часто так бывает, если модель генерации нарушила формат. Попробуйте снова или выберите другую модель.',
    questions_unparsed:
      'Блок вопросов в ответе есть, но список не разобрался. Ниже можно открыть полный текст ответа или повторить генерацию.',
    weak_question_options:
      'Вопросы распознаны, но почти без вариантов ответа (остались заглушки). Имеет смысл повторить генерацию или заполнить поле «Свой ответ».',
  }

  useEffect(() => {
    setError(null)
    Promise.all([api.getSettings(), api.getModels(), api.getTechniques(), api.getWorkspaces()])
      .then(([settings, modelsRes, techniquesRes, workspaceRes]) => {
        setModelsData(modelsRes.data)
        const labels = modelsRes.data.reduce<Record<string, string>>((acc, item: OpenRouterModel) => {
          acc[item.id] = item.name || item.id
          return acc
        }, { unknown: 'Неизвестно / Любая модель' })
        setModelLabels(labels)
        setGenerationOptions(settings.preferred_generation_models)
        setGenModel((current) => current || settings.preferred_generation_models[0] || '')
        const items = techniquesRes.techniques.map((item) => ({
          id: String(item.id),
          name: String(item.name || item.id),
        }))
        setTechniques(items)
        setWorkspaces(workspaceRes.items)
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Ошибка загрузки данных')
        setWorkspaces([])
        setTechniques([])
      })
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
          target_model: 'unknown',
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
  }, [taskInput, workspaceId, techniqueMode, manualTechs, iterationMode, result?.prompt_block, ideOverrides, evidenceDecisions, previewSeed])

  const handleGenerate = async (questionAnswers?: { question: string; answers: string[] }[]) => {
    if (!taskInput.trim()) return
    window.scrollTo({ top: 0, behavior: 'smooth' })
    lastQuestionAnswersRef.current = questionAnswers
    setIssueBannerDismissed(false)
    setLoading(true)
    setError(null)
    try {
      const req: GenerateRequest = {
        task_input: taskInput.trim(),
        feedback: iterationMode ? feedback : '',
        gen_model: genModel,
        target_model: 'unknown',
        domain: 'auto',
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

  const handleRetryGeneration = () => {
    const qa = lastQuestionAnswersRef.current
    void handleGenerate(qa !== undefined ? qa : undefined)
  }

  const startSplitDrag = useCallback(
    (which: 1 | 2) => (e: React.MouseEvent) => {
      e.preventDefault()
      const root = splitRootRef.current
      if (!root) return
      const w = Math.max(root.getBoundingClientRect().width, 1)
      const startX = e.clientX
      const a0 = splits.splitA
      const b0 = splits.splitB

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX
        const dFrac = dx / w
        if (which === 1) {
          const nextA = clampSplit(a0 + dFrac, MIN_COL_FRAC, b0 - MIN_COL_FRAC)
          setSplits({ splitA: nextA, splitB: b0 })
        } else {
          const nextB = clampSplit(b0 + dFrac, a0 + MIN_COL_FRAC, 1 - MIN_COL_FRAC)
          setSplits({ splitA: a0, splitB: nextB })
        }
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        document.body.style.removeProperty('cursor')
        document.body.style.removeProperty('user-select')
        setSplits((cur) => {
          localStorage.setItem(
            HOME_SPLIT_KEY,
            JSON.stringify({ splitA: cur.splitA, splitB: cur.splitB }),
          )
          return cur
        })
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [splits.splitA, splits.splitB],
  )

  const handleNewSession = () => {
    setResult(null)
    setSessionId(null)
    setIterationMode(false)
    setShowSaveDialog(false)
    setQuestionState({})
    setIssueBannerDismissed(false)
  }

  const handleSaveToLibrary = async () => {
    if (!result?.prompt_block) return
    await api.saveToLibrary({
      title: saveTitle || taskInput.slice(0, 60) || 'Без названия',
      prompt: result.prompt_block,
      tags: saveTags.split(',').map((t) => t.trim()).filter(Boolean),
      target_model: 'unknown',
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
  const previewIssueCount = preview?.debug_issues?.length || 0

  const estimatePromptCost = (modelId: string, tokenEst: number): string | null => {
    const model = modelsData.find((m) => m.id === modelId)
    if (!model?.pricing?.prompt || tokenEst <= 0) return null
    const cost = (model.pricing.prompt * tokenEst) / 1_000_000
    if (cost < 0.0001) return '<$0.0001'
    return `~$${cost.toFixed(4)}`
  }
  const promptCostStr = result?.gen_model && result?.metrics?.token_estimate
    ? estimatePromptCost(result.gen_model, Number(result.metrics.token_estimate))
    : null
  const previewEvidenceCount = Object.keys(preview?.evidence || {}).length
  const previewIntentCount = preview?.intent_graph?.length || 0
  const tokenEstimate = Number(result?.metrics?.token_estimate ?? 0)

  const taskPlaceholder =
    'Опишите задачу: цель, формат ответа, аудитория, ограничения, пример входа/выхода…'

  const renderTaskColumn = () => (
    <div className={styles.columnStack}>
      <section className={`${styles.panel} ${styles.taskPanel}`}>
        <div className={styles.panelHeader}>
          <h2>{iterationMode ? 'Итерация' : 'Задача'}</h2>
          {(iterationMode ? feedback.trim() : taskInput.trim()) ? (
            <CopyIconButton text={iterationMode ? feedback : taskInput} title="Копировать текст задачи" />
          ) : null}
        </div>
        <div className={cb.composer}>
          {iterationMode ? (
            <p className={`${styles.info} ${styles.composerIterationHint}`}>Опиши, что изменить в текущем промпте.</p>
          ) : null}
          {iterationMode ? (
            <AutoTextarea
              className={cb.composerTextarea}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="Добавить few-shot примеры, сократить на 30%..."
              minHeightPx={72}
              maxHeightPx={420}
              spellCheck
            />
          ) : (
            <AutoTextarea
              className={cb.composerTextarea}
              value={taskInput}
              onChange={(e) => setTaskInput(e.target.value)}
              placeholder={taskPlaceholder}
              minHeightPx={88}
              maxHeightPx={480}
              spellCheck
            />
          )}
          {!iterationMode ? (
            <div className={styles.hintChips} aria-label="Подсказки к задаче">
              {['Цель и формат', 'Аудитория', 'Ограничения', 'Пример в/в'].map((label) => (
                <span key={label} className={styles.hintChip}>
                  {label}
                </span>
              ))}
            </div>
          ) : null}
          <div className={cb.composerFooter}>
            <div className={cb.composerFooterRow}>
              <div className={cb.composerFooterStart}>
                <Link to="/models" className={cb.composerIconBtn} title="Каталог моделей" aria-label="Каталог моделей">
                  +
                </Link>
              </div>
              <div className={cb.composerFooterMid}>
                <select
                  className={cb.composerSelect}
                  value={genModel}
                  onChange={(e) => setGenModel(e.target.value)}
                  aria-label="Модель генерации"
                  title="Модель генерации"
                >
                  {generationOptions.map((id) => (
                    <option key={id} value={id}>{modelLabels[id] || id}</option>
                  ))}
                </select>
                <select
                  className={cb.composerSelect}
                  value={workspaceId}
                  onChange={(e) => setWorkspaceId(Number(e.target.value))}
                  aria-label="Workspace"
                  title="Workspace"
                >
                  <option value={0}>Без workspace</option>
                  {workspaces.map((ws) => (
                    <option key={ws.id ?? 0} value={ws.id ?? 0}>{ws.name}</option>
                  ))}
                </select>
                <div className={styles.techSegment} role="group" aria-label="Режим техник">
                  <button
                    type="button"
                    className={`${styles.techSegmentBtn} ${techniqueMode === 'auto' ? styles.techSegmentBtnActive : ''}`}
                    aria-pressed={techniqueMode === 'auto'}
                    onClick={() => setTechniqueMode('auto')}
                  >
                    Авто
                  </button>
                  <button
                    type="button"
                    className={`${styles.techSegmentBtn} ${techniqueMode === 'manual' ? styles.techSegmentBtnActive : ''}`}
                    aria-pressed={techniqueMode === 'manual'}
                    onClick={() => setTechniqueMode('manual')}
                  >
                    Вручную
                  </button>
                </div>
                <button
                  type="button"
                  className={cb.composerGhostBtn}
                  onClick={() => setShowAdvanced(!showAdvanced)}
                >
                  {showAdvanced ? 'Меньше' : 'Доп.'}
                </button>
              </div>
              <div className={cb.composerFooterEnd}>
                <button type="button" className={cb.composerLinkBtn} onClick={handleNewSession}>
                  Новая сессия
                </button>
                <button
                  type="button"
                  className={cb.composerSend}
                  onClick={() => handleGenerate()}
                  disabled={!taskInput.trim() || loading}
                  title={iterationMode ? 'Обновить промпт' : 'Создать промпт'}
                  aria-label={iterationMode ? 'Обновить промпт' : 'Создать промпт'}
                >
                  {loading ? <span className={cb.composerSendSpinner} aria-hidden /> : <span aria-hidden>↑</span>}
                </button>
              </div>
            </div>
            <div className={cb.composerFooterMeta}>
              <span className={cb.metaMuted}>
                Токенов: {tokenEstimate ? tokenEstimate.toLocaleString() : '—'}
                {promptCostStr ? ` · ${promptCostStr}` : ''}
              </span>
            </div>
          </div>
          {techniqueMode === 'manual' && (
            <div className={`${cb.composerInset} ${styles.techPickerInset}`}>
              <div className={styles.techPickerHead}>
                <span className={styles.techListLabel}>Техники</span>
                {manualTechs.length > 0 ? (
                  <span className={styles.techPickCount}>Выбрано: {manualTechs.length}</span>
                ) : null}
              </div>
              <div className={checkboxList.gridWrap} role="group" aria-label="Выбор техник для генерации">
                {techniques.map((t) => (
                  <label key={t.id} className={checkboxList.optionCheck}>
                    <input
                      type="checkbox"
                      checked={manualTechs.includes(t.id)}
                      onChange={() => {
                        setManualTechs((prev) =>
                          prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id],
                        )
                      }}
                    />
                    <span>{t.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {showAdvanced && (
            <div className={cb.composerInset}>
              <div className={styles.advancedInline}>
                <label className={styles.advancedInlineField}>
                  Т° {temperature}
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.1}
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  />
                </label>
                <label className={styles.advancedInlineField}>
                  Top-P {topP.toFixed(2)}
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={topP}
                    onChange={(e) => setTopP(parseFloat(e.target.value))}
                  />
                </label>
                <label className={styles.advancedInlineField}>
                  Top-K
                  <input
                    type="number"
                    value={topK}
                    onChange={(e) => setTopK(e.target.value ? Number(e.target.value) : '')}
                    className={styles.topKInput}
                  />
                </label>
                <label className={styles.questionsCompact}>
                  <input type="checkbox" checked={questionsMode} onChange={(e) => setQuestionsMode(e.target.checked)} />
                  <span>Вопросы</span>
                </label>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )

  return (
    <div className={styles.home}>
      {loading && (
        <div className={styles.loadingBar}>
          <div className={styles.loadingBarGradient} />
          <span className={styles.loadingBarText}>
            {iterationMode ? 'Обновляю промпт...' : 'Генерирую промпт...'}
          </span>
        </div>
      )}

      <div ref={splitRootRef} className={styles.splitRoot}>
          <div
            className={styles.splitPane}
            style={{ flex: `${splits.splitA} 1 0%`, minWidth: 0 }}
          >
            {renderTaskColumn()}
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Граница колонок Задача и IDE — перетащите для изменения ширины"
            className={styles.splitGutter}
            onMouseDown={startSplitDrag(1)}
          />
          <div
            className={styles.splitPane}
            style={{ flex: `${splits.splitB - splits.splitA} 1 0%`, minWidth: 0 }}
          >
        <section className={`${styles.panel} ${styles.ideColumn}`}>
          {preview ? (
            <div className={styles.ideBox}>
              <div className={styles.ideHeader}>
                <div>
                  <h3>IDE-анализ</h3>
                  <p className={styles.ideHint}>
                    {taskSummary || 'Анализ структуры задачи'}
                    {preview.techniques.length > 0 ? ` · ${preview.techniques.map((t) => t.name).join(', ')}` : ''}
                  </p>
                </div>
                <div className={styles.ideStats}>
                  <span>{previewIntentCount} intent nodes</span>
                  <span>{previewIssueCount} issues</span>
                  <span>{previewEvidenceCount} evidence</span>
                  {previewLoading && <span>Обновляю...</span>}
                </div>
              </div>

              <div className={styles.intentStrip}>
                {(preview.intent_graph || []).slice(0, 6).map((node) => (
                  <div key={node.id} className={`${styles.intentNode} ${node.status?.toLowerCase() === 'known' ? styles.intentKnown : ''} ${node.status?.toLowerCase() === 'missing' ? styles.intentMissing : ''}`}>
                    <strong>{node.label}</strong>
                    <span>{node.status}</span>
                  </div>
                ))}
              </div>

              <div className={styles.ideTabs}>
                <button className={ideTab === 'spec' ? styles.ideTabActive : styles.ideTab} onClick={() => setIdeTab('spec')}>Spec</button>
                <button className={ideTab === 'intent' ? styles.ideTabActive : styles.ideTab} onClick={() => setIdeTab('intent')}>Intent</button>
                <button className={ideTab === 'issues' ? styles.ideTabActive : styles.ideTab} onClick={() => setIdeTab('issues')}>Issues</button>
                <button className={ideTab === 'evidence' ? styles.ideTabActive : styles.ideTab} onClick={() => setIdeTab('evidence')}>Evidence</button>
              </div>

              {ideTab === 'spec' && (
                <div className={styles.compactPanel}>
                  <div className={styles.specGrid}>
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
                      <textarea rows={3} value={ideSourceOfTruth} onChange={(e) => setIdeSourceOfTruth(e.target.value)} />
                    </label>
                    <label>
                      Критерии успеха
                      <textarea rows={3} value={ideSuccessCriteria} onChange={(e) => setIdeSuccessCriteria(e.target.value)} />
                    </label>
                    <label className={styles.specWide}>
                      Ограничения
                      <textarea rows={3} value={ideConstraints} onChange={(e) => setIdeConstraints(e.target.value)} />
                    </label>
                  </div>
                </div>
              )}

              {ideTab === 'intent' && (
                <div className={styles.compactPanel}>
                  <div className={styles.listPanel}>
                    {(preview.intent_graph || []).map((node) => (
                      <div key={node.id} className={`${styles.ideItem} ${styles.intentItem} ${node.status?.toLowerCase() === 'known' ? styles.intentKnown : ''} ${node.status?.toLowerCase() === 'missing' ? styles.intentMissing : ''}`}>
                        <strong>{node.label}</strong> <span>{node.status} · {node.criticality}</span>
                        {node.value && <p>{node.value}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {ideTab === 'issues' && (
                <div className={styles.compactPanel}>
                  <div className={styles.listPanel}>
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
                </div>
              )}

              {ideTab === 'evidence' && (
                <div className={styles.compactPanel}>
                  <div className={styles.listPanel}>
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
              )}
            </div>
          ) : (
            <div className={styles.emptyStatePanel}>
              <h3>IDE-анализ</h3>
              <p>Здесь появятся intent map, issues и evidence после того, как задача станет достаточно конкретной.</p>
            </div>
          )}
        </section>
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Граница колонок IDE и Результат — перетащите для изменения ширины"
            className={styles.splitGutter}
            onMouseDown={startSplitDrag(2)}
          />
          <div
            className={styles.splitPane}
            style={{ flex: `${1 - splits.splitB} 1 0%`, minWidth: 0 }}
          >
        <section className={`${styles.panel} ${styles.resultColumn}`}>
          <h2>Результат</h2>
          {result?.generation_issue && !issueBannerDismissed && (
            <div className={styles.issueBanner} role="alert">
              <button
                type="button"
                className={styles.issueBannerClose}
                aria-label="Закрыть предупреждение"
                onClick={() => setIssueBannerDismissed(true)}
              >
                ×
              </button>
              <p>{GENERATION_ISSUE_TEXT[result.generation_issue]}</p>
              <div className={styles.issueBannerActions}>
                <button type="button" className={styles.primaryAction} onClick={handleRetryGeneration}>
                  Попробовать снова
                </button>
              </div>
            </div>
          )}
          {error && <p className={styles.error}>{error}</p>}
          {!result && !error && (
            <p className={styles.empty}>Опиши задачу в левой колонке и нажми <strong>Создать промпт</strong></p>
          )}
          {result?.has_prompt && (
            <>
              <div className={styles.promptToolbar}>
                <CopyIconButton text={result.prompt_block} title="Копировать промпт" />
              </div>
              <textarea
                className={styles.resultPrompt}
                value={result.prompt_block}
                readOnly
                rows={12}
              />
              {result.reasoning && (
                <details>
                  <summary>Почему именно эти техники?</summary>
                  <div className={styles.preToolbar}>
                    <CopyIconButton text={result.reasoning} title="Копировать reasoning" />
                  </div>
                  <pre className={styles.reasoning}>{result.reasoning}</pre>
                </details>
              )}
              {result.prompt_spec && (
                <>
                  <button className={styles.ideModalBtn} onClick={() => setShowIdeModal(true)}>
                    Prompt IDE: spec / debugger / evidence
                  </button>
                  {showIdeModal && (
                    <div className={styles.modalOverlay} onClick={() => setShowIdeModal(false)}>
                      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                          <h3>Prompt IDE</h3>
                          <button className={styles.modalClose} onClick={() => setShowIdeModal(false)}>×</button>
                        </div>
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
                      </div>
                    </div>
                  )}
                </>
              )}
              {result.metrics && (
                <div className={styles.metricsBox}>
                  <h3>Метрики промпта</h3>
                  <div className={styles.metricGrid}>
                    <div><strong>Токены:</strong> {String(result.metrics.token_estimate ?? 0)}</div>
                    {promptCostStr && <div><strong>Оценка стоимости:</strong> {promptCostStr}</div>}
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
                <button className={styles.iterateBtn} onClick={() => setIterationMode(true)}>Итерировать</button>
                <button onClick={() => navigate('/compare', { state: { taskInput: result.task_input || taskInput } })}>Сравнить</button>
                <button className={styles.libraryBtn} onClick={() => {
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
                    <button className={styles.primaryAction} onClick={handleSaveToLibrary}>Сохранить</button>
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
          {result &&
            result.llm_raw?.trim() &&
            !result.has_prompt &&
            (!result.has_questions || !result.questions?.length) && (
            <div className={styles.rawFallback}>
              <p className={styles.info}>
                Ответ модели не удалось разобрать по маркерам [PROMPT] / [QUESTIONS]. Ниже — полный текст; при необходимости скопируйте промпт вручную.
              </p>
              <details open>
                <summary>Текст ответа модели</summary>
                <div className={styles.preToolbar}>
                  <CopyIconButton text={result.llm_raw} title="Копировать ответ модели" />
                </div>
                <pre className={styles.llmRaw}>{result.llm_raw}</pre>
              </details>
            </div>
          )}
          {result?.has_questions && !result?.has_prompt && (
            <div className={styles.questionBox}>
              <p className={styles.info}>
                Отметь один или несколько вариантов (чекбоксы). При необходимости допиши свой ответ в поле ниже.
              </p>
              {(result.questions || []).map((q, idx) => {
                const state = questionState[idx] || { options: [], custom: '' }
                return (
                  <div key={idx} className={styles.questionItem}>
                    <strong>{idx + 1}. {q.question}</strong>
                    <div className={checkboxList.optionChecks} role="group" aria-label={`Варианты для вопроса ${idx + 1}`}>
                      {q.options.map((option, optIdx) => (
                        <label key={`${idx}-${optIdx}-${option}`} className={checkboxList.optionCheck}>
                          <input
                            type="checkbox"
                            checked={state.options.includes(option)}
                            onChange={() => {
                              setQuestionState((prev) => {
                                const cur = prev[idx] ?? { options: [], custom: '' }
                                const on = cur.options.includes(option)
                                const nextOpts = on
                                  ? cur.options.filter((x) => x !== option)
                                  : [...cur.options, option]
                                return { ...prev, [idx]: { ...cur, options: nextOpts } }
                              })
                            }}
                          />
                          <span>{option}</span>
                        </label>
                      ))}
                    </div>
                    <input
                      value={state.custom}
                      placeholder="Свой ответ (добавится к выбранным)"
                      onChange={(e) => setQuestionState((prev) => {
                        const cur = prev[idx] ?? { options: [], custom: '' }
                        return { ...prev, [idx]: { ...cur, custom: e.target.value } }
                      })}
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
        </section>
          </div>
        </div>
    </div>
  )
}
