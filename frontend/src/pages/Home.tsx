import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
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
import MarkdownOutput from '../components/MarkdownOutput'
import SelectDropdown from '../components/SelectDropdown'
import WorkspacePicker from '../components/WorkspacePicker'
import { CopyIconButton, TryInGeminiButton } from '../components/PromptToolbarIcons'
import { pushRecentSession } from '../lib/recentSessions'
import { suggestLibraryTitle } from '../lib/libraryTitle'
import { clearAgentDraft, loadAgentDraft, saveAgentDraft } from '../lib/agentDraft'
import { isConversationalOnlyMessage } from '../lib/conversationalGate'
import {
  COMPLETENESS_SCORE_TITLE,
  PROMPT_COST_TITLE,
  TECHNIQUES_COUNT_TITLE,
  TOKEN_ESTIMATE_TITLE,
} from '../lib/scoreTooltips'
import { shortGenerationModelLabel } from '../utils/generationModelLabel'
import checkboxList from '../styles/CheckboxOptionList.module.css'
import cb from '../styles/ComposerBar.module.css'
import styles from './Home.module.css'

const ACTIVE_WORKSPACE_KEY = 'prompt-engineer-active-workspace'
const ACTIVE_SESSION_KEY = 'prompt-engineer-active-prompt-session'
const HOME_SPLIT_KEY = 'prompt-engineer-home-split'
const HOME_MODE_KEY = 'prompt-engineer-home-creation-mode'
const HOME_AGENT_SPLIT_KEY = 'prompt-engineer-home-agent-split'
type CreationMode = 'classic' | 'agent'

const AGENT_WELCOME =
  'Опишите задачу в чате — при необходимости задам уточнения, затем соберу промпт справа. Модель генерации, целевая модель и рабочую область можно выбрать внизу.'

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

function loadCreationMode(): CreationMode {
  try {
    const raw = localStorage.getItem(HOME_MODE_KEY)
    if (raw === 'agent' || raw === 'classic') return raw
  } catch {
    /* ignore */
  }
  return 'classic'
}

const DEFAULT_AGENT_SPLIT = 0.38
function loadAgentSplit(): number {
  try {
    const raw = localStorage.getItem(HOME_AGENT_SPLIT_KEY)
    if (raw) {
      const n = parseFloat(raw)
      if (!Number.isNaN(n)) return clampSplit(n, 0.22, 0.62)
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_AGENT_SPLIT
}

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  clarificationQA?: { question: string; answers: string[] }[]
}

type Technique = { id: string; name: string }

function IconGlobe() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

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
  const [preferredTargetModels, setPreferredTargetModels] = useState<string[]>(['unknown'])
  const [targetModel, setTargetModel] = useState('unknown')
  const [splits, setSplits] = useState(() => loadHomeSplits())
  const [creationMode, setCreationMode] = useState<CreationMode>(() => loadCreationMode())
  const [agentSplit, setAgentSplit] = useState(() => loadAgentSplit())
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [baseTaskRef, setBaseTaskRef] = useState('')
  const splitRootRef = useRef<HTMLDivElement>(null)
  const agentSplitRootRef = useRef<HTMLDivElement>(null)
  const agentChatScrollRef = useRef<HTMLDivElement>(null)
  const [issueBannerDismissed, setIssueBannerDismissed] = useState(false)
  const lastQuestionAnswersRef = useRef<{ question: string; answers: string[] }[] | undefined>(undefined)
  const lastClarificationsMsgIdRef = useRef<string | null>(null)
  const agentStudioBootstrappedRef = useRef(false)
  const [inputTokens, setInputTokens] = useState<{ tokens: number; method: string } | null>(null)
  const [questionCarouselIdx, setQuestionCarouselIdx] = useState(0)

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
        const targets = settings.preferred_target_models?.length
          ? settings.preferred_target_models
          : ['unknown']
        setPreferredTargetModels(targets)
        setTargetModel((prev) => {
          if (prev !== 'unknown' && targets.includes(prev)) return prev
          return targets[0] || 'unknown'
        })
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
    localStorage.setItem(HOME_MODE_KEY, creationMode)
  }, [creationMode])

  useEffect(() => {
    if (creationMode !== 'agent') {
      agentStudioBootstrappedRef.current = false
      return
    }
    if (agentStudioBootstrappedRef.current) return
    agentStudioBootstrappedRef.current = true
    const draft = loadAgentDraft()
    if (draft && draft.chatMessages.length > 0) {
      const msgs = draft.chatMessages as ChatMessage[]
      setChatMessages(msgs)
      setBaseTaskRef(draft.baseTaskRef)
      setTaskInput(draft.taskInput)
      setFeedback(draft.feedback)
      setResult(draft.result)
      setSessionId(draft.sessionId)
      setIterationMode(draft.iterationMode)
      setQuestionState(draft.questionState)
      setQuestionCarouselIdx(draft.questionCarouselIdx)
      setQuickSaved(draft.quickSaved)
      if (draft.sessionId) localStorage.setItem(ACTIVE_SESSION_KEY, draft.sessionId)
      const pendingClar = [...msgs]
        .reverse()
        .find(
          (m) =>
            m.role === 'assistant' &&
            m.content.includes('Нужны уточнения') &&
            m.clarificationQA === undefined,
        )
      lastClarificationsMsgIdRef.current = pendingClar?.id ?? null
      return
    }
    setChatMessages((msgs) => {
      if (msgs.length > 0) return msgs
      return [{ id: 'welcome', role: 'assistant', content: AGENT_WELCOME }]
    })
  }, [creationMode])

  useEffect(() => {
    const state = location.state as {
      prefillTask?: string
      clearResult?: boolean
      restoreSessionId?: string
    } | null
    if (state?.restoreSessionId) {
      setSessionId(state.restoreSessionId)
      navigate(location.pathname, { replace: true, state: null })
      return
    }
    if (state?.prefillTask) {
      const t = state.prefillTask
      setTaskInput(t)
      setBaseTaskRef(t)
      if (creationMode === 'agent') {
        setChatMessages([
          { id: 'welcome', role: 'assistant', content: AGENT_WELCOME },
          { id: crypto.randomUUID(), role: 'user', content: t },
        ])
      }
      if (state.clearResult) setResult(null)
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [location.pathname, location.state, navigate, creationMode])

  useEffect(() => {
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, String(workspaceId))
  }, [workspaceId])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('metaprompt-workspace', { detail: { id: workspaceId } }))
  }, [workspaceId])

  useEffect(() => {
    const ws = workspaces.find((w) => w.id != null && w.id === workspaceId)
    const pref = ws?.config?.preferred_target_model
    if (pref && pref !== 'unknown') {
      setTargetModel(pref)
    }
  }, [workspaceId, workspaces])

  useEffect(() => {
    if (sessionId) {
      localStorage.setItem(ACTIVE_SESSION_KEY, sessionId)
      api.getSessionVersions(sessionId).then((r) => setVersions(r.items)).catch(() => setVersions([]))
    } else {
      localStorage.removeItem(ACTIVE_SESSION_KEY)
      setVersions([])
    }
  }, [sessionId])

  useEffect(() => {
    setQuestionCarouselIdx(0)
  }, [result?.has_questions, result?.questions])

  useEffect(() => {
    if (creationMode !== 'agent') return
    const el = agentChatScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [creationMode, chatMessages, result?.has_questions, result?.questions, loading, error])

  useEffect(() => {
    const text = iterationMode ? feedback : taskInput
    if (!text.trim()) {
      setInputTokens(null)
      return
    }
    const timer = window.setTimeout(() => {
      api.countTokens(text, genModel).then(setInputTokens).catch(() => {})
    }, 400)
    return () => window.clearTimeout(timer)
  }, [taskInput, feedback, iterationMode, genModel])

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
  }, [
    taskInput,
    workspaceId,
    targetModel,
    techniqueMode,
    manualTechs,
    iterationMode,
    result?.prompt_block,
    ideOverrides,
    evidenceDecisions,
    previewSeed,
  ])

  type GenerateOptions = {
    taskInputOverride?: string
    feedbackOverride?: string
    forceIteration?: boolean
    previousPromptOverride?: string
    skipAgentChatReplies?: boolean
  }

  const handleGenerate = async (
    questionAnswers?: { question: string; answers: string[] }[],
    opts?: GenerateOptions,
  ) => {
    const effectiveTask = (opts?.taskInputOverride ?? taskInput).trim()
    if (!effectiveTask) return
    if (creationMode === 'classic') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
    lastQuestionAnswersRef.current = questionAnswers
    setIssueBannerDismissed(false)
    setLoading(true)
    setError(null)
    const isIteration =
      opts?.forceIteration !== undefined ? opts.forceIteration : iterationMode
    const feedbackText = isIteration ? (opts?.feedbackOverride ?? feedback).trim() : ''
    const previousPrompt =
      isIteration
        ? opts?.previousPromptOverride ?? result?.prompt_block
        : undefined
    try {
      const req: GenerateRequest = {
        task_input: effectiveTask,
        feedback: isIteration ? feedbackText : '',
        gen_model: genModel,
        target_model: targetModel,
        domain: 'auto',
        technique_mode: techniqueMode,
        manual_techs: techniqueMode === 'manual' ? manualTechs : [],
        temperature,
        top_p: topP,
        top_k: topK === '' ? undefined : topK,
        questions_mode: questionsMode && !questionAnswers?.length,
        session_id: sessionId || undefined,
        previous_prompt: previousPrompt && previousPrompt.trim() ? previousPrompt : undefined,
        workspace_id: workspaceId || null,
        prompt_spec_overrides: ideOverrides,
        evidence_decisions: evidenceDecisions,
        question_answers: questionAnswers || [],
      }
      const res = await api.generate(req)
      setResult(res)
      setSessionId(res.session_id)
      pushRecentSession(res.session_id, effectiveTask)
      setIterationMode(false)
      setQuestionState({})
      setQuickSaved(false)
      if (creationMode === 'agent' && !opts?.skipAgentChatReplies) {
        setChatMessages((prev) => {
          let next: ChatMessage[] = [...prev]
          if (questionAnswers !== undefined && lastClarificationsMsgIdRef.current) {
            const cid = lastClarificationsMsgIdRef.current
            next = next.map((m) => (m.id === cid ? { ...m, clarificationQA: questionAnswers } : m))
            lastClarificationsMsgIdRef.current = null
          }
          if (res.has_prompt) {
            const thinkingParts: string[] = []
            if (res.techniques?.length) {
              thinkingParts.push(`**Техники:** ${res.techniques.map((t) => t.name).join(', ')}`)
            }
            if (res.reasoning) {
              const short = res.reasoning.length > 400 ? res.reasoning.slice(0, 400) + '…' : res.reasoning
              thinkingParts.push(short)
            }
            if (res.metrics) {
              const score = Number(res.metrics.completeness_score ?? res.metrics.quality_score ?? 0)
              const tokens = Number(res.metrics.token_estimate ?? 0)
              const parts: string[] = []
              if (score > 0) parts.push(`полнота ${score}%`)
              if (tokens > 0) parts.push(`≈${tokens.toLocaleString()} токенов`)
              if (parts.length) thinkingParts.push(`**Оценка:** ${parts.join(' · ')}`)
            }
            if (res.metrics && Array.isArray(res.metrics.improvement_tips) && (res.metrics.improvement_tips as string[]).length > 0) {
              thinkingParts.push(`**Можно улучшить:** ${(res.metrics.improvement_tips as string[]).join('; ')}`)
            }
            if (thinkingParts.length > 0) {
              next.push({
                id: crypto.randomUUID(),
                role: 'assistant',
                content: `__thinking__\n${thinkingParts.join('\n\n')}`,
              })
            }
            next.push({
              id: crypto.randomUUID(),
              role: 'assistant',
              content: 'Готово — промпт справа. Напишите в чат, что изменить.',
            })
          } else if (res.has_questions && (res.questions?.length || 0) > 0) {
            const cid = crypto.randomUUID()
            lastClarificationsMsgIdRef.current = cid
            next.push({
              id: cid,
              role: 'assistant',
              content:
                'Нужны уточнения: ответьте во всплывающем окне, листайте до последнего вопроса — там кнопка «Создать промпт с этими ответами».',
            })
          }
          queueMicrotask(() => {
            saveAgentDraft({
              chatMessages: next,
              baseTaskRef,
              taskInput,
              feedback,
              result: res,
              sessionId: res.session_id,
              iterationMode: false,
              questionState: {},
              questionCarouselIdx: 0,
              quickSaved: false,
            })
          })
          return next
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка генерации')
    } finally {
      setLoading(false)
    }
  }

  const handleRetryGeneration = () => {
    const qa = lastQuestionAnswersRef.current
    const taskOverride =
      creationMode === 'agent' ? (baseTaskRef || taskInput).trim() || undefined : undefined
    void handleGenerate(qa !== undefined ? qa : undefined, taskOverride ? { taskInputOverride: taskOverride } : undefined)
  }

  const resetAgentDialog = () => {
    clearAgentDraft()
    lastClarificationsMsgIdRef.current = null
    setChatMessages([{ id: 'welcome', role: 'assistant', content: AGENT_WELCOME }])
    setChatInput('')
    setBaseTaskRef('')
    setTaskInput('')
    setFeedback('')
    setResult(null)
    setSessionId(null)
    setIterationMode(false)
    setQuestionState({})
    setError(null)
    localStorage.removeItem(ACTIVE_SESSION_KEY)
  }

  const handleAgentSend = () => {
    const text = chatInput.trim()
    if (!text || loading) return
    if (result?.has_questions && !result?.has_prompt) {
      setError('Сначала завершите уточнения во всплывающем окне (до последнего вопроса).')
      return
    }
    setChatInput('')
    setChatMessages((m) => [...m, { id: crypto.randomUUID(), role: 'user', content: text }])
    setError(null)

    const baseBefore = (baseTaskRef || taskInput).trim()
    if (!result?.has_prompt && !baseBefore && isConversationalOnlyMessage(text)) {
      setChatMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content:
            'Привет! Я помогу составить или улучшить промпт под вашу модель. Опишите задачу одним сообщением (например: «промпт для разбора писем в CRM») — результат появится справа.',
        },
      ])
      return
    }

    if (result?.has_prompt && result.prompt_block) {
      void handleGenerate(undefined, {
        taskInputOverride: (baseTaskRef || taskInput).trim(),
        feedbackOverride: text,
        forceIteration: true,
        previousPromptOverride: result.prompt_block,
      })
      return
    }

    const base = (baseTaskRef || taskInput).trim()
    if (!base) {
      setBaseTaskRef(text)
      setTaskInput(text)
      void handleGenerate(undefined, { taskInputOverride: text })
      return
    }

    const merged = `${base}\n\nДополнение: ${text}`
    setBaseTaskRef(merged)
    setTaskInput(merged)
    void handleGenerate(undefined, { taskInputOverride: merged })
  }

  const startAgentSplitDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const root = agentSplitRootRef.current
      if (!root) return
      const w = Math.max(root.getBoundingClientRect().width, 1)
      const startX = e.clientX
      const s0 = agentSplit

      const onMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX
        const dFrac = dx / w
        const next = clampSplit(s0 + dFrac, 0.22, 0.62)
        setAgentSplit(next)
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        document.body.style.removeProperty('cursor')
        document.body.style.removeProperty('user-select')
        setAgentSplit((cur) => {
          localStorage.setItem(HOME_AGENT_SPLIT_KEY, String(cur))
          return cur
        })
      }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [agentSplit],
  )

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

  const [quickSaved, setQuickSaved] = useState(false)

  useEffect(() => {
    if (creationMode !== 'agent') return
    const t = window.setTimeout(() => {
      saveAgentDraft({
        chatMessages,
        baseTaskRef,
        taskInput,
        feedback,
        result,
        sessionId,
        iterationMode,
        questionState,
        questionCarouselIdx,
        quickSaved,
      })
    }, 450)
    return () => window.clearTimeout(t)
  }, [
    creationMode,
    chatMessages,
    baseTaskRef,
    taskInput,
    feedback,
    result,
    sessionId,
    iterationMode,
    questionState,
    questionCarouselIdx,
    quickSaved,
  ])

  const handleSaveToLibrary = async () => {
    if (!result?.prompt_block) return
    const title = saveTitle.trim() || suggestLibraryTitle(taskInput)
    await api.saveToLibrary({
      title,
      prompt: result.prompt_block,
      tags: saveTags.split(',').map((t) => t.trim()).filter(Boolean),
      target_model: targetModel,
      task_type: result.task_types?.[0] || 'general',
      techniques: result.technique_ids,
      notes: saveNotes,
    })
    window.dispatchEvent(new CustomEvent('metaprompt-nav-refresh'))
    setShowSaveDialog(false)
    setSaveNotes('')
    setSaveTags('')
    setQuickSaved(true)
  }

  const handleQuickSave = async () => {
    if (!result?.prompt_block) return
    const title = suggestLibraryTitle(taskInput)
    await api.saveToLibrary({
      title,
      prompt: result.prompt_block,
      tags: saveTags.split(',').map((t) => t.trim()).filter(Boolean),
      target_model: targetModel,
      task_type: result.task_types?.[0] || 'general',
      techniques: result.technique_ids,
    })
    window.dispatchEvent(new CustomEvent('metaprompt-nav-refresh'))
    setQuickSaved(true)
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
  const costModelId =
    result?.target_model && result.target_model !== 'unknown' ? result.target_model : result?.gen_model
  const promptCostStr =
    costModelId && result?.metrics?.token_estimate
      ? estimatePromptCost(costModelId, Number(result.metrics.token_estimate))
      : null
  const previewEvidenceCount = Object.keys(preview?.evidence || {}).length
  const previewIntentCount = preview?.intent_graph?.length || 0
  const tokenEstimate = Number(result?.metrics?.token_estimate ?? 0)

  const taskPlaceholder = 'Опишите задачу подробно'
  const genModelSelectOptions = useMemo(
    () =>
      generationOptions.map((id) => {
        const full = modelLabels[id] || id
        return { value: id, label: shortGenerationModelLabel(full), title: full }
      }),
    [generationOptions, modelLabels],
  )

  const targetModelSelectOptions = useMemo(
    () =>
      preferredTargetModels.map((id) => ({
        value: id,
        label:
          id === 'unknown'
            ? 'Любая модель'
            : shortGenerationModelLabel(modelLabels[id] || id),
        title: id === 'unknown' ? 'Промпт без привязки к конкретной модели' : modelLabels[id] || id,
      })),
    [preferredTargetModels, modelLabels],
  )
  const ideOutputFormatOptions = useMemo(
    () => [
      { value: '', label: 'Автоопределение' },
      { value: 'json', label: 'json' },
      { value: 'xml', label: 'xml' },
      { value: 'yaml', label: 'yaml' },
      { value: 'markdown', label: 'markdown' },
      { value: 'table', label: 'table' },
      { value: 'list', label: 'list' },
    ],
    [],
  )

  const renderTaskColumn = () => (
    <div className={styles.columnStack}>
      <section className={`${styles.panel} ${styles.taskPanel}`}>
        <div className={styles.panelHeader}>
          <div className={styles.taskTitleWithSwitch}>
            <h2 className="pageTitleGradient">{iterationMode ? 'Итерация' : 'Задача'}</h2>
            <button
              type="button"
              className={styles.creationModeFlip}
              title="Режим агента: чат слева"
              aria-label="Переключить на режим агента"
              onClick={() => setCreationMode('agent')}
            >
              ◇
            </button>
          </div>
          <div className={styles.panelHeaderEnd}>
            <span className={cb.metaMuted} title={inputTokens ? `Метод: ${inputTokens.method === 'tiktoken' ? 'точный (tiktoken)' : 'приблизительный'}` : 'Оценка по последней генерации'}>
              {inputTokens
                ? `${inputTokens.tokens.toLocaleString()} ${inputTokens.method === 'tiktoken' ? 'токенов' : '≈ токенов'}`
                : tokenEstimate
                  ? `${tokenEstimate.toLocaleString()} токенов`
                  : ''}
              {promptCostStr ? ` · ${promptCostStr}` : ''}
            </span>
            {(iterationMode ? feedback.trim() : taskInput.trim()) ? (
              <CopyIconButton text={iterationMode ? feedback : taskInput} title="Копировать текст задачи" />
            ) : null}
          </div>
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
          <div className={cb.composerFooter}>
            <div className={cb.composerFooterRow}>
              <div className={cb.composerFooterMid}>
                <SelectDropdown
                  value={genModel}
                  options={genModelSelectOptions}
                  onChange={setGenModel}
                  aria-label="Модель генерации"
                  variant="composer"
                  footerLink={{ to: '/models', label: 'Добавить модель' }}
                />
                <WorkspacePicker workspaces={workspaces} workspaceId={workspaceId} onSelect={setWorkspaceId} />
                <SelectDropdown
                  value={targetModel}
                  options={targetModelSelectOptions}
                  onChange={setTargetModel}
                  aria-label="Модель, для которой пишется промпт"
                  variant="composer"
                  footerLink={{ to: '/models', label: 'Каталог моделей' }}
                  triggerContent={targetModel === 'unknown' ? <IconGlobe /> : undefined}
                  triggerClassName={targetModel === 'unknown' ? styles.targetTriggerIconOnly : ''}
                />
                <button
                  type="button"
                  className={styles.techModeMicro}
                  title={techniqueMode === 'auto' ? 'Техники: авто — нажмите для выбора вручную' : 'Техники: вручную — нажмите для авто'}
                  aria-label={techniqueMode === 'auto' ? 'Режим техник: авто' : 'Режим техник: вручную'}
                  aria-pressed={techniqueMode === 'manual'}
                  onClick={() => setTechniqueMode((m) => (m === 'auto' ? 'manual' : 'auto'))}
                >
                  {techniqueMode === 'auto' ? 'A' : '✎'}
                </button>
                <button
                  type="button"
                  className={cb.composerGhostBtn}
                  onClick={() => setShowAdvanced(!showAdvanced)}
                >
                  {showAdvanced ? 'Меньше' : 'Доп.'}
                </button>
              </div>
              <div className={cb.composerFooterEnd}>
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

  const questionGenOpts: GenerateOptions | undefined =
    creationMode === 'agent' && (baseTaskRef || taskInput).trim()
      ? { taskInputOverride: (baseTaskRef || taskInput).trim() }
      : undefined

  const renderQuestionsPanel = (placement: 'classic' | 'agent' = 'classic') => {
    const compact = placement === 'agent'
    const qs = result?.questions || []
    const total = qs.length
    if (total === 0) return null
    const idx = Math.min(Math.max(0, questionCarouselIdx), total - 1)
    const q = qs[idx]
    const state = questionState[idx] || { options: [], custom: '' }

    return (
      <div className={`${styles.questionBox} ${compact ? styles.questionBoxCompact : ''} ${styles.questionCarousel}`}>
        <div className={styles.wizardProgressWrap}>
          <div className={styles.wizardProgressBar}>
            <div className={styles.wizardProgressFill} style={{ width: `${((idx + 1) / total) * 100}%` }} />
          </div>
          <span className={styles.questionCarouselMeta}>
            {idx + 1} / {total}
          </span>
        </div>
        <p className={`${styles.info} ${compact ? styles.wizardInfoCompact : ''}`}>
          Ответ на каждый вопрос необязателен. Дойдите до последнего — там кнопка создания промпта.
        </p>
        <div className={`${styles.questionItem} ${compact ? styles.questionItemCompact : ''}`}>
          <strong>
            {idx + 1}. {q.question}
          </strong>
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
                      const nextOpts = on ? cur.options.filter((x) => x !== option) : [...cur.options, option]
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
            onChange={(e) =>
              setQuestionState((prev) => {
                const cur = prev[idx] ?? { options: [], custom: '' }
                return { ...prev, [idx]: { ...cur, custom: e.target.value } }
              })
            }
          />
        </div>
        <div className={styles.questionCarouselNav}>
          <button
            type="button"
            className="btn-ghost"
            disabled={idx <= 0}
            onClick={() => setQuestionCarouselIdx((i) => Math.max(0, i - 1))}
          >
            ← Назад
          </button>
          {idx < total - 1 ? (
            <button
              type="button"
              className={`${styles.primaryAction} btn-primary ${styles.wizardNextPrimary}`}
              onClick={() => setQuestionCarouselIdx((i) => Math.min(total - 1, i + 1))}
            >
              Далее: вопрос {idx + 2} из {total} →
            </button>
          ) : (
            <span className={styles.wizardLastHint}>Последний вопрос</span>
          )}
        </div>
        <div className={styles.actions}>
          <button type="button" className="btn-ghost" disabled={loading} onClick={() => handleGenerate([], questionGenOpts)}>
            Пропустить ответы
          </button>
          {idx >= total - 1 ? (
            <button
              type="button"
              className={`${styles.primaryAction} btn-primary`}
              disabled={loading}
              onClick={() =>
                handleGenerate(
                  qs.map((qq, i) => ({
                    question: qq.question,
                    answers: [
                      ...(questionState[i]?.options || []),
                      ...((questionState[i]?.custom || '').trim() ? [questionState[i]!.custom.trim()] : []),
                    ],
                  })),
                  questionGenOpts,
                )
              }
            >
              Создать промпт с этими ответами
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  const ideSection = (
        <section
          className={`${styles.panel} ${styles.ideColumn} ${styles.bareColumn} ${
            creationMode === 'agent' ? styles.agentStackSection : ''
          }`}
        >
          {preview ? (
            <div className={styles.ideBox}>
              <div className={styles.ideHeader}>
                <div>
                  <h3 className="pageTitleGradient">Разбор задачи</h3>
                  <p className={styles.ideHint}>
                    {taskSummary || 'Анализ структуры задачи'}
                    {preview.techniques.length > 0 ? ` · ${preview.techniques.map((t) => t.name).join(', ')}` : ''}
                  </p>
                </div>
                <div className={styles.ideStats}>
                  <span>{previewIntentCount} пунктов цели</span>
                  <span>{previewIssueCount} замечаний</span>
                  <span>{previewEvidenceCount} фрагментов контекста</span>
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
                <button className={ideTab === 'spec' ? styles.ideTabActive : styles.ideTab} onClick={() => setIdeTab('spec')}>Спека</button>
                <button className={ideTab === 'intent' ? styles.ideTabActive : styles.ideTab} onClick={() => setIdeTab('intent')}>Намерение</button>
                <button className={ideTab === 'issues' ? styles.ideTabActive : styles.ideTab} onClick={() => setIdeTab('issues')}>Замечания</button>
                <button className={ideTab === 'evidence' ? styles.ideTabActive : styles.ideTab} onClick={() => setIdeTab('evidence')}>Доказательства</button>
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
                      <SelectDropdown
                        value={ideOutputFormat}
                        options={ideOutputFormatOptions}
                        onChange={setIdeOutputFormat}
                        aria-label="Формат вывода"
                        variant="field"
                        className={styles.specSelectDrop}
                      />
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
                            <button type="button" className="btn-secondary" onClick={() => setEvidenceDecisions((prev) => ({ ...prev, [field]: 'accept' }))}>Принять</button>
                            <button type="button" className="btn-ghost" onClick={() => setEvidenceDecisions((prev) => ({ ...prev, [field]: 'reject' }))}>Отклонить</button>
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
              <h3 className="pageTitleGradient">Разбор задачи</h3>
              <p>Здесь появится анализ: цель, уточнения и контекст — после того как формулировка задачи станет достаточно конкретной.</p>
            </div>
          )}
        </section>
  )

  const resultSection = (
        <section
          className={`${styles.panel} ${styles.resultColumn} ${styles.bareColumn} ${
            creationMode === 'agent' ? styles.agentStackSection : ''
          }`}
        >
          <h2 className="pageTitleGradient">Результат</h2>
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
                <button type="button" className={`${styles.primaryAction} btn-primary`} onClick={handleRetryGeneration}>
                  Попробовать снова
                </button>
              </div>
            </div>
          )}
          {creationMode === 'classic' && error && <p className={styles.error}>{error}</p>}
          {!result && !error && (
            <div className={`${styles.resultPlaceholder} ${loading ? styles.resultPlaceholderLoading : ''}`}>
              <div className={styles.resultPlaceholderIcon} aria-hidden>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="8" y1="13" x2="16" y2="13" />
                  <line x1="8" y1="17" x2="14" y2="17" />
                </svg>
              </div>
              <p className={styles.resultPlaceholderTitle}>Промпт появится здесь</p>
              <p className={styles.resultPlaceholderHint}>
                {creationMode === 'agent'
                  ? 'Промпт появится здесь после диалога слева.'
                  : 'Опишите задачу в левой колонке и нажмите кнопку отправки, чтобы создать промпт.'}
              </p>
            </div>
          )}
          {result?.has_prompt && (
            <>
              <div className={styles.evalStrip}>
                <div className={styles.evalStripLeft}>
                  {result.metrics && (() => {
                    const score = Number(result.metrics.completeness_score ?? result.metrics.quality_score ?? 0)
                    return score > 0 ? (
                      <div className={styles.evalScorePrimary} title={COMPLETENESS_SCORE_TITLE}>
                        <span className={styles.evalScoreLabel}>Полнота</span>
                        <div className={styles.evalBar}>
                          <div className={styles.evalBarFill} style={{ width: `${Math.min(100, score)}%` }} />
                        </div>
                        <span className={styles.evalScoreNum}>{score}%</span>
                      </div>
                    ) : null
                  })()}
                  {result.techniques?.length > 0 && (
                    <span
                      className={styles.evalMeta}
                      title={`${TECHNIQUES_COUNT_TITLE} Сейчас: ${result.techniques.map((t) => t.name).join(', ')}.`}
                    >
                      {result.techniques.length} техн.
                    </span>
                  )}
                  {tokenEstimate > 0 && (
                    <span className={styles.evalMetaSecondary} title={TOKEN_ESTIMATE_TITLE}>
                      ≈{tokenEstimate.toLocaleString()} tok
                    </span>
                  )}
                  {promptCostStr ? (
                    <span className={styles.evalMetaSecondary} title={PROMPT_COST_TITLE}>
                      {promptCostStr}
                    </span>
                  ) : null}
                </div>
                <div className={styles.promptToolbar}>
                  <CopyIconButton text={result.prompt_block} title="Копировать промпт" />
                  <TryInGeminiButton prompt={result.prompt_block} />
                  {creationMode === 'agent' && !quickSaved && (
                    <button
                      type="button"
                      className={styles.quickSaveBtn}
                      title="Сохранить в библиотеку"
                      onClick={handleQuickSave}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                    </button>
                  )}
                  {creationMode === 'agent' && quickSaved && (
                    <span className={styles.quickSavedMark} title="Сохранено в библиотеку">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                    </span>
                  )}
                </div>
              </div>
              <div className={styles.resultMarkdownWrap}>
                <MarkdownOutput>{result.prompt_block}</MarkdownOutput>
              </div>
              {result.reasoning && creationMode === 'classic' && (
                <details>
                  <summary>Почему именно эти техники?</summary>
                  <div className={styles.preToolbar}>
                    <CopyIconButton text={result.reasoning} title="Копировать пояснение" />
                  </div>
                  <div className={styles.reasoningMd}>
                    <MarkdownOutput>{result.reasoning}</MarkdownOutput>
                  </div>
                </details>
              )}
              {result.prompt_spec && (
                <>
                  <button type="button" className={styles.ideModalBtn} onClick={() => setShowIdeModal(true)}>
                    Подробнее: спецификация и проверки
                  </button>
                  {showIdeModal && (
                    <div className={styles.modalOverlay} onClick={() => setShowIdeModal(false)}>
                      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.modalHeader}>
                          <h3>Спецификация промпта</h3>
                          <button className={styles.modalClose} onClick={() => setShowIdeModal(false)}>×</button>
                        </div>
                        <div className={styles.ideGrid}>
                    <div className={styles.ideSection}>
                      <h3>Спецификация</h3>
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
                      <h3>Проверка промпта</h3>
                      {(result.debug_issues || []).length === 0 ? (
                        <p className={styles.success}>Критичных замечаний к структуре промпта не найдено.</p>
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
                      <h3>Контекст и источники</h3>
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
              {result.target_model_type === 'reasoning' && (
                <div className={styles.reasoningBadge}>
                  Reasoning-модель — техники адаптированы: убраны CoT и step-by-step, промпт компактнее
                </div>
              )}
              {result.metrics && Array.isArray(result.metrics.improvement_tips) && result.metrics.improvement_tips.length > 0 && (
                <div className={styles.tipsBox}>
                  <strong>Что можно улучшить:</strong>
                  <ul>
                    {(result.metrics.improvement_tips as string[]).map((tip, idx) => (
                      <li key={idx} className={styles.tipItem}>
                        <span className={styles.tipText}>{tip}</span>
                        <button
                          type="button"
                          className={styles.tipApplyBtn}
                          disabled={loading}
                          title="Автоматически применить этот совет"
                          onClick={() => {
                            if (creationMode === 'agent') {
                              setChatInput(`Примени совет: ${tip}`)
                            } else {
                              setFeedback(tip)
                              setIterationMode(true)
                            }
                          }}
                        >
                          + Применить
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result?.has_prompt && (
                <p className={styles.strategicHint} title={COMPLETENESS_SCORE_TITLE}>
                  Оценка полноты смотрит на структуру промпта (эвристика на устройстве/сервере), а не на ответ модели в чате. Перед важным использованием проверьте текст в своей модели.
                </p>
              )}
              <div className={styles.actions}>
                {creationMode !== 'agent' ? (
                  <button type="button" className={`${styles.iterateBtn} btn-primary`} onClick={() => setIterationMode(true)}>Итерировать</button>
                ) : null}
                <button type="button" className="btn-secondary" onClick={() => navigate('/compare', { state: { taskInput: result.task_input || taskInput } })}>Сравнить</button>
                <button
                  type="button"
                  className={`${styles.libraryBtn} btn-secondary`}
                  onClick={() => {
                    setShowSaveDialog((prev) => {
                      if (!prev) setSaveTitle(suggestLibraryTitle(taskInput))
                      return !prev
                    })
                  }}
                >В библиотеку</button>
              </div>
              {showSaveDialog && (
                <div className={styles.saveBox}>
                  <h3>Сохранить в библиотеку</h3>
                  <label className={styles.saveFieldLabel}>
                    Название в библиотеке
                    <input
                      value={saveTitle}
                      onChange={(e) => setSaveTitle(e.target.value)}
                      placeholder="Краткое имя записи"
                      aria-describedby="save-title-hint"
                    />
                  </label>
                  <p id="save-title-hint" className={styles.saveHint}>
                    Показывается в списке карточек. Если оставить пустым — подставим первые слова задачи (не весь текст).
                  </p>
                  <input value={saveTags} onChange={(e) => setSaveTags(e.target.value)} placeholder="Теги через запятую" />
                  <textarea value={saveNotes} onChange={(e) => setSaveNotes(e.target.value)} rows={3} placeholder="Заметки" />
                  <div className={styles.actions}>
                    <button type="button" className={`${styles.primaryAction} btn-primary`} onClick={handleSaveToLibrary}>Сохранить</button>
                    <button type="button" className="btn-ghost" onClick={() => setShowSaveDialog(false)}>Отмена</button>
                  </div>
                </div>
              )}
              {versions.length > 1 && (
                <div className={styles.versionTimeline}>
                  <div className={styles.versionTimelineHeader}>
                    <span className={styles.versionTimelineLabel}>Версии</span>
                    <span className={styles.versionTimelineCount}>{versions.length}</span>
                    {(() => {
                      const scores = versions.map((v) => {
                        const m = ((v as Record<string, unknown>).metrics || {}) as Record<string, unknown>
                        return Number(m.completeness_score ?? m.quality_score ?? 0)
                      }).filter((s) => s > 0)
                      if (scores.length < 2) return null
                      const max = Math.max(...scores, 100)
                      const w = 72
                      const h = 20
                      const step = w / (scores.length - 1)
                      const pts = scores.map((s, i) => `${i * step},${h - (s / max) * h}`).join(' ')
                      return (
                        <svg className={styles.sparkline} width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
                          <polyline points={pts} fill="none" stroke="var(--primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )
                    })()}
                  </div>
                  <div className={styles.versionPills}>
                    {([...versions].reverse()).map((item) => {
                      const v = item as Record<string, unknown>
                      const m = (v.metrics || {}) as Record<string, unknown>
                      const score = Number(m.completeness_score ?? m.quality_score ?? 0)
                      const tok = Number(m.token_estimate ?? 0)
                      const isCurrent = result?.prompt_block === String(v.final_prompt || '')
                      return (
                        <button
                          key={String(v.version)}
                          type="button"
                          className={`${styles.versionPill} ${isCurrent ? styles.versionPillActive : ''}`}
                          title={`v${String(v.version)} · ${String(v.created_at || '')}${score ? ` · ${score}%` : ''}${tok ? ` · ≈${tok} tok` : ''}`}
                          onClick={() => setResult((prev) => prev ? { ...prev, prompt_block: String(v.final_prompt || '') } : prev)}
                        >
                          <span className={styles.versionPillNum}>v{String(v.version)}</span>
                          {score > 0 && <span className={styles.versionPillScore}>{score}%</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
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
          {creationMode === 'classic' && result?.has_questions && !result?.has_prompt && renderQuestionsPanel('classic')}
        </section>
  )

  return (
    <div className={`${styles.home} ${styles.homeFlexFill}`}>
      {loading && creationMode === 'classic' && (
        <div className={styles.loadingBar}>
          <div className={styles.loadingBarGradient} />
          <span className={styles.loadingBarText}>
            {iterationMode ? 'Обновляю промпт...' : 'Генерирую промпт...'}
          </span>
        </div>
      )}

      {creationMode === 'classic' ? (
        <div ref={splitRootRef} className={`${styles.splitRoot} ${styles.splitRootFill}`}>
          <div className={styles.splitPane} style={{ flex: `${splits.splitA} 1 0%`, minWidth: 0 }}>
            {renderTaskColumn()}
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Граница колонок «Задача» и «Разбор задачи» — перетащите для изменения ширины"
            className={styles.splitGutter}
            onMouseDown={startSplitDrag(1)}
          />
          <div className={styles.splitPane} style={{ flex: `${splits.splitB - splits.splitA} 1 0%`, minWidth: 0 }}>
            {ideSection}
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Граница колонок «Разбор задачи» и «Результат» — перетащите для изменения ширины"
            className={styles.splitGutter}
            onMouseDown={startSplitDrag(2)}
          />
          <div className={styles.splitPane} style={{ flex: `${1 - splits.splitB} 1 0%`, minWidth: 0 }}>
            {resultSection}
          </div>
        </div>
      ) : (
        <div ref={agentSplitRootRef} className={`${styles.splitRoot} ${styles.splitRootFill}`}>
          <div
            className={`${styles.splitPane} ${styles.splitPaneAgentChat}`}
            style={{ flex: `${agentSplit} 1 0%`, minWidth: 0 }}
          >
            <div className={styles.agentChatColumn}>
              <div className={styles.agentChatHeader}>
                <div className={styles.agentTaskTitleRow}>
                  <h2 className="pageTitleGradient">Задача</h2>
                  <button
                    type="button"
                    className={styles.creationModeFlip}
                    title="Классический вид: три колонки"
                    aria-label="Переключить на классический режим"
                    onClick={() => setCreationMode('classic')}
                  >
                    ▦
                  </button>
                </div>
                <button type="button" className={styles.agentNewChatBtn} onClick={resetAgentDialog}>
                  Новый диалог
                </button>
              </div>
              <p className={styles.agentDraftHint} title="Черновик студии хранится в браузере и подхватывается при возврате на эту страницу. Список «Сессии» в сайдбаре — отдельно, это сохранённые на сервере сессии с версиями.">
                Черновик сохраняется в браузере при переходах по сайту. «Новый диалог» очищает его.
              </p>
              <div className={styles.agentChatBody}>
                <div ref={agentChatScrollRef} className={styles.agentChatScroll}>
                  {chatMessages.map((m) => {
                    const isThinking = m.role === 'assistant' && m.content.startsWith('__thinking__\n')
                    const displayContent = isThinking ? m.content.slice('__thinking__\n'.length) : m.content
                    if (isThinking) {
                      const firstLine = displayContent.split('\n')[0] || 'Анализ задачи'
                      return (
                        <details key={m.id} className={styles.chatBubbleThinking}>
                          <summary className={styles.thinkingSummary}>
                            <span className={styles.thinkingLabel}>Размышления</span>
                            <span className={styles.thinkingSummaryText}>{firstLine.replace(/\*\*/g, '')}</span>
                          </summary>
                          <div className={styles.thinkingBody}>
                            <MarkdownOutput>{displayContent}</MarkdownOutput>
                          </div>
                        </details>
                      )
                    }
                    return (
                      <div
                        key={m.id}
                        className={m.role === 'user' ? styles.chatBubbleUser : styles.chatBubbleAssistant}
                      >
                        <MarkdownOutput>{displayContent}</MarkdownOutput>
                        {m.role === 'assistant' && m.clarificationQA !== undefined ? (
                          <details className={styles.clarificationRecap}>
                            <summary>Показать вопросы и ответы</summary>
                            <div className={styles.clarificationRecapBody}>
                              {m.clarificationQA.length === 0 ? (
                                <p className={styles.clarificationRecapEmpty}>Ответы не выбраны — учтена только ваша формулировка задачи.</p>
                              ) : (
                                <ol className={styles.clarificationRecapList}>
                                  {m.clarificationQA.map((row, i) => (
                                    <li key={i}>
                                      <div className={styles.clarificationQ}>{row.question}</div>
                                      <div className={styles.clarificationA}>
                                        {row.answers.length ? row.answers.join('; ') : '—'}
                                      </div>
                                    </li>
                                  ))}
                                </ol>
                              )}
                            </div>
                          </details>
                        ) : null}
                      </div>
                    )
                  })}
                  {loading && (
                    <div className={styles.agentThinking} aria-live="polite">
                      <span className={styles.agentThinkingInner}>Думаю над промптом и уточнениями…</span>
                    </div>
                  )}
                  {error && <p className={styles.error}>{error}</p>}
                </div>
                {result?.has_questions && !result?.has_prompt && (
                  <div className={styles.wizardOverlay}>
                    {renderQuestionsPanel('agent')}
                  </div>
                )}
              </div>
              <div className={styles.agentChatComposerHost}>
              <div className={cb.composer}>
                <AutoTextarea
                  className={cb.composerTextarea}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Опишите задачу или попросите изменить промпт…"
                  minHeightPx={72}
                  maxHeightPx={280}
                  spellCheck
                />
                <div className={cb.composerFooter}>
                  <div className={cb.composerFooterRow}>
                    <div className={cb.composerFooterMid}>
                      <SelectDropdown
                        value={genModel}
                        options={genModelSelectOptions}
                        onChange={setGenModel}
                        aria-label="Модель генерации"
                        variant="composer"
                        footerLink={{ to: '/models', label: 'Добавить модель' }}
                      />
                      <WorkspacePicker workspaces={workspaces} workspaceId={workspaceId} onSelect={setWorkspaceId} />
                      <SelectDropdown
                        value={targetModel}
                        options={targetModelSelectOptions}
                        onChange={setTargetModel}
                        aria-label="Модель, для которой пишется промпт"
                        variant="composer"
                        footerLink={{ to: '/models', label: 'Каталог моделей' }}
                        triggerContent={targetModel === 'unknown' ? <IconGlobe /> : undefined}
                        triggerClassName={targetModel === 'unknown' ? styles.targetTriggerIconOnly : ''}
                      />
                      <button
                        type="button"
                        className={styles.techModeMicro}
                        title={techniqueMode === 'auto' ? 'Техники: авто — нажмите для выбора вручную' : 'Техники: вручную — нажмите для авто'}
                        aria-label={techniqueMode === 'auto' ? 'Режим техник: авто' : 'Режим техник: вручную'}
                        aria-pressed={techniqueMode === 'manual'}
                        onClick={() => setTechniqueMode((m) => (m === 'auto' ? 'manual' : 'auto'))}
                      >
                        {techniqueMode === 'auto' ? 'A' : '✎'}
                      </button>
                      <button
                        type="button"
                        className={cb.composerGhostBtn}
                        onClick={() => setShowAdvanced(!showAdvanced)}
                      >
                        {showAdvanced ? 'Меньше' : 'Доп.'}
                      </button>
                    </div>
                    <div className={cb.composerFooterEnd}>
                      <button
                        type="button"
                        className={cb.composerSend}
                        onClick={handleAgentSend}
                        disabled={!chatInput.trim() || loading}
                        title="Отправить в чат"
                        aria-label="Отправить в чат"
                      >
                        {loading ? <span className={cb.composerSendSpinner} aria-hidden /> : <span aria-hidden>↑</span>}
                      </button>
                    </div>
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
              </div>
            </div>
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Граница «Задача» и «Результат» — перетащите для изменения ширины"
            className={styles.splitGutter}
            onMouseDown={startAgentSplitDrag}
          />
          <div
            className={`${styles.splitPane} ${styles.splitPaneAgentRight}`}
            style={{ flex: `${1 - agentSplit} 1 0%`, minWidth: 0, overflow: 'auto' }}
          >
            {resultSection}
          </div>
        </div>
      )}
    </div>
  )
}
