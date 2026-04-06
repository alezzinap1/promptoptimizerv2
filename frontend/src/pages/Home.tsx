import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  api,
  type GenerateRequest,
  type GenerateResult,
  type GenerationIssue,
  type ImageMetaResponse,
  type UserPresetRecord,
  type OpenRouterModel,
  type PromptIdePreviewResponse,
  type Workspace,
} from '../api/client'
import AutoTextarea from '../components/AutoTextarea'
import MarkdownOutput from '../components/MarkdownOutput'
import SelectDropdown from '../components/SelectDropdown'
import WorkspacePicker from '../components/WorkspacePicker'
import FirstVisitHomeTip from '../components/FirstVisitHomeTip'
import { CopyIconButton, TryInGeminiButton } from '../components/PromptToolbarIcons'
import { pushRecentSession } from '../lib/recentSessions'
import { suggestLibraryTitle } from '../lib/libraryTitle'
import { clearAgentDraftV2, loadAgentDraftV2, saveAgentDraftV2 } from '../lib/agentDraft'
import {
  createEmptyStudioSnapshot,
  defaultWelcomeForMode,
  type AgentStudioSnapshot,
  type PromptStudioMode,
} from '../lib/agentStudioModes'
import { clearSessionAgentChat, loadSessionAgentChat, saveSessionAgentChat } from '../lib/sessionAgentChat'
import ImageStylePickerPopover from '../components/ImageStylePickerPopover'
import PublishToCommunityModal, { type PublishToCommunityInitial } from '../components/PublishToCommunityModal'
import {
  isConversationalOnlyMessage,
  pickAfterPromptChatReply,
  pickConversationalReply,
} from '../lib/conversationalGate'
import { resolveAgentFollowUpPlan } from '../lib/agentPlanResolver'
import {
  COMPLETENESS_SCORE_TITLE,
  PROMPT_COST_TITLE,
  TECHNIQUES_COUNT_TITLE,
  TOKEN_ESTIMATE_TITLE,
} from '../lib/scoreTooltips'
import { IMAGE_STYLES_ALL, IMAGE_STYLES_BY_ID } from '../lib/imageStyles'
import { loadImageStyleFavoriteIds, saveImageStyleFavoriteIds } from '../lib/imageStyleFavorites'
import { appendRecentTechniqueIds, loadRecentTechniqueIds } from '../lib/recentTechniques'
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

/** Минимальная доля ширины на колонку (0–1) */
const MIN_COL_FRAC = 0.14
const DEFAULT_SPLIT_A = 0.33
const DEFAULT_SPLIT_B = 0.66

/** Если в ответе одновременно [PROMPT] и хвост [QUESTIONS], UI зависает в режиме вопросов. */
function normalizeClientGenerateResult(res: GenerateResult): GenerateResult {
  if (!res.has_prompt) return res
  return { ...res, has_questions: false, questions: [] }
}

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
  return 'agent'
}

/** Ротация фраз в агентском режиме во время генерации */
const AGENT_THINKING_PHASES = [
  'Разбираю формулировку задачи…',
  'Сопоставляю с типом задачи и контекстом…',
  'Подбираю техники и структуру ответа…',
  'Продумываю уточнения и ограничения…',
  'Собираю формулировку промпта…',
  'Проверяю согласованность и полноту…',
]

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
  const [workspacesReady, setWorkspacesReady] = useState(false)
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
  const [promptType, setPromptType] = useState<'text' | 'image' | 'skill'>('text')
  const [imagePromptTags, setImagePromptTags] = useState<string[]>([])
  const [imageMeta, setImageMeta] = useState<ImageMetaResponse | null>(null)
  const [userPresetsImage, setUserPresetsImage] = useState<UserPresetRecord[]>([])
  const [userPresetsSkill, setUserPresetsSkill] = useState<UserPresetRecord[]>([])
  const [imagePresetId, setImagePresetId] = useState('')
  const [imageEngine, setImageEngine] = useState('auto')
  const [imageDeepMode, setImageDeepMode] = useState(false)
  const [imageStylePickerOpen, setImageStylePickerOpen] = useState(false)
  const [imageStyleFavorites, setImageStyleFavorites] = useState<Set<string>>(() =>
    typeof window !== 'undefined' ? loadImageStyleFavoriteIds() : new Set(),
  )
  const [skillPresetId, setSkillPresetId] = useState('')
  const [baseTaskRef, setBaseTaskRef] = useState('')
  const [questionCarouselIdx, setQuestionCarouselIdx] = useState(0)
  const [quickSaved, setQuickSaved] = useState(false)
  /** Снимки студии по вкладкам «Текст / Фото / Скилл» — при переключении не смешиваем чаты и сессии. */
  const studioModesRef = useRef<Record<PromptStudioMode, AgentStudioSnapshot>>({
    text: createEmptyStudioSnapshot('text'),
    image: createEmptyStudioSnapshot('image'),
    skill: createEmptyStudioSnapshot('skill'),
  })

  const hydrateFromSnapshot = useCallback((s: AgentStudioSnapshot) => {
    setChatMessages(s.chatMessages as ChatMessage[])
    setTaskInput(s.taskInput)
    setBaseTaskRef(s.baseTaskRef)
    setFeedback(s.feedback)
    setResult(s.result)
    setSessionId(s.sessionId)
    setIterationMode(s.iterationMode)
    setQuestionState(s.questionState)
    setQuestionCarouselIdx(s.questionCarouselIdx)
    setQuickSaved(s.quickSaved)
    setImagePromptTags(s.imagePromptTags)
    setImagePresetId(s.imagePresetId)
    setImageEngine(s.imageEngine)
    setImageDeepMode(s.imageDeepMode)
    setSkillPresetId(s.skillPresetId)
    const pendingClar = [...s.chatMessages]
      .reverse()
      .find(
        (m) =>
          m.role === 'assistant' &&
          m.content.includes('Нужны уточнения') &&
          m.clarificationQA === undefined,
      )
    lastClarificationsMsgIdRef.current = pendingClar?.id ?? null
  }, [])

  const persistCurrentModeToRef = useCallback(() => {
    studioModesRef.current[promptType] = {
      chatMessages,
      taskInput,
      baseTaskRef,
      feedback,
      result,
      sessionId,
      iterationMode,
      questionState,
      questionCarouselIdx,
      quickSaved,
      imagePromptTags,
      imagePresetId,
      imageEngine,
      imageDeepMode,
      skillPresetId,
    }
  }, [
    promptType,
    chatMessages,
    taskInput,
    baseTaskRef,
    feedback,
    result,
    sessionId,
    iterationMode,
    questionState,
    questionCarouselIdx,
    quickSaved,
    imagePromptTags,
    imagePresetId,
    imageEngine,
    imageDeepMode,
    skillPresetId,
  ])

  const handlePromptTypeChange = useCallback(
    (next: PromptStudioMode) => {
      if (next === promptType) return
      persistCurrentModeToRef()
      const incoming = studioModesRef.current[next]
      hydrateFromSnapshot(incoming)
      setPromptType(next)
      if (incoming.sessionId?.trim()) {
        localStorage.setItem(ACTIVE_SESSION_KEY, incoming.sessionId)
      } else {
        localStorage.removeItem(ACTIVE_SESSION_KEY)
      }
      setError(null)
      setIssueBannerDismissed(false)
    },
    [promptType, persistCurrentModeToRef, hydrateFromSnapshot],
  )

  const splitRootRef = useRef<HTMLDivElement>(null)
  const agentSplitRootRef = useRef<HTMLDivElement>(null)
  const agentChatScrollRef = useRef<HTMLDivElement>(null)
  const imageStyleMoreBtnRef = useRef<HTMLButtonElement>(null)
  const [issueBannerDismissed, setIssueBannerDismissed] = useState(false)
  const lastQuestionAnswersRef = useRef<{ question: string; answers: string[] }[] | undefined>(undefined)
  const lastClarificationsMsgIdRef = useRef<string | null>(null)
  const agentStudioBootstrappedRef = useRef(false)
  const restoredFromSidebarRef = useRef(false)
  const [agentThinkingIdx, setAgentThinkingIdx] = useState(0)
  const [publishCommunityOpen, setPublishCommunityOpen] = useState(false)
  const [inputTokens, setInputTokens] = useState<{ tokens: number; method: string } | null>(null)

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
        setWorkspacesReady(true)
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Ошибка загрузки данных')
        setWorkspaces([])
        setTechniques([])
        setWorkspacesReady(true)
      })
  }, [])

  useEffect(() => {
    api
      .getImageOptions()
      .then(setImageMeta)
      .catch(() => setImageMeta({ presets: [] }))
  }, [])

  const reloadUserPresets = useCallback(() => {
    api
      .listPresets('image')
      .then((r) => setUserPresetsImage(r.items))
      .catch(() => setUserPresetsImage([]))
    api
      .listPresets('skill')
      .then((r) => setUserPresetsSkill(r.items))
      .catch(() => setUserPresetsSkill([]))
  }, [])

  useEffect(() => {
    reloadUserPresets()
    const onRefresh = () => reloadUserPresets()
    window.addEventListener('metaprompt-presets-refresh', onRefresh)
    return () => window.removeEventListener('metaprompt-presets-refresh', onRefresh)
  }, [reloadUserPresets])

  useEffect(() => {
    localStorage.setItem(HOME_MODE_KEY, creationMode)
  }, [creationMode])

  const toggleImageTag = useCallback((id: string) => {
    setImagePromptTags((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }, [])

  const toggleImageStyleFavorite = useCallback((id: string) => {
    setImageStyleFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  useEffect(() => {
    saveImageStyleFavoriteIds(imageStyleFavorites)
  }, [imageStyleFavorites])

  const imagePresetSelectOptions = useMemo(() => {
    const presets = imageMeta?.presets ?? []
    return [
      { value: '', label: 'Без пресета' },
      ...presets.map((p) => ({ value: p.id, label: p.name, title: p.description })),
      ...userPresetsImage.map((p) => ({
        value: `u_${p.id}`,
        label: p.name,
        title: p.description || undefined,
      })),
    ]
  }, [imageMeta, userPresetsImage])

  const skillPresetSelectOptions = useMemo(
    () => [
      { value: '', label: 'Без пресета' },
      ...userPresetsSkill.map((p) => ({
        value: `u_${p.id}`,
        label: p.name,
        title: p.description || undefined,
      })),
    ],
    [userPresetsSkill],
  )

  useEffect(() => {
    const allowed = new Set([
      '',
      ...(imageMeta?.presets ?? []).map((p) => p.id),
      ...userPresetsImage.map((p) => `u_${p.id}`),
    ])
    if (imagePresetId && !allowed.has(imagePresetId)) setImagePresetId('')
  }, [imageMeta, userPresetsImage, imagePresetId])

  useEffect(() => {
    const allowed = new Set(['', ...userPresetsSkill.map((p) => `u_${p.id}`)])
    if (skillPresetId && !allowed.has(skillPresetId)) setSkillPresetId('')
  }, [userPresetsSkill, skillPresetId])

  useLayoutEffect(() => {
    const state = location.state as { restoreSessionId?: string } | null
    if (!state?.restoreSessionId) return
    const sid = state.restoreSessionId
    restoredFromSidebarRef.current = true
    setSessionId(sid)
    const stored = loadSessionAgentChat(sid)
    if (stored && stored.length > 0) {
      setChatMessages(stored as ChatMessage[])
      const pendingClar = [...stored]
        .reverse()
        .find(
          (m) =>
            m.role === 'assistant' &&
            m.content.includes('Нужны уточнения') &&
            m.clarificationQA === undefined,
        )
      lastClarificationsMsgIdRef.current = pendingClar?.id ?? null
    } else {
      setChatMessages([{ id: 'welcome', role: 'assistant', content: defaultWelcomeForMode('text') }])
      lastClarificationsMsgIdRef.current = null
    }
    navigate(location.pathname, { replace: true, state: null })
  }, [location.state, location.pathname, navigate])

  useEffect(() => {
    if (creationMode !== 'agent') {
      agentStudioBootstrappedRef.current = false
      return
    }
    if (agentStudioBootstrappedRef.current) return
    if (restoredFromSidebarRef.current) {
      agentStudioBootstrappedRef.current = true
      restoredFromSidebarRef.current = false
      return
    }
    agentStudioBootstrappedRef.current = true
    const draft = loadAgentDraftV2()
    if (draft) {
      studioModesRef.current = draft.modes
      setPromptType(draft.activePromptType)
      hydrateFromSnapshot(draft.modes[draft.activePromptType])
      const sid = draft.modes[draft.activePromptType].sessionId
      if (sid?.trim()) localStorage.setItem(ACTIVE_SESSION_KEY, sid)
      else localStorage.removeItem(ACTIVE_SESSION_KEY)
      return
    }
    setChatMessages((msgs) => {
      if (msgs.length > 0) return msgs
      return [{ id: 'welcome', role: 'assistant', content: defaultWelcomeForMode('text') }]
    })
  }, [creationMode, hydrateFromSnapshot])

  useEffect(() => {
    const state = location.state as {
      prefillTask?: string
      clearResult?: boolean
      restoreSessionId?: string
    } | null
    if (state?.prefillTask) {
      const t = state.prefillTask
      setTaskInput(t)
      setBaseTaskRef(t)
      if (creationMode === 'agent') {
        setChatMessages([
          { id: 'welcome', role: 'assistant', content: defaultWelcomeForMode('text') },
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
    if (!workspacesReady || workspaceId <= 0) return
    const has = workspaces.some((w) => Number(w.id ?? 0) === workspaceId)
    if (has) return
    let cancelled = false
    api
      .getWorkspace(workspaceId)
      .then((r) => {
        if (cancelled) return
        setWorkspaces((prev) => {
          if (prev.some((w) => Number(w.id ?? 0) === workspaceId)) return prev
          return [...prev, r.item]
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [workspacesReady, workspaceId, workspaces])

  useEffect(() => {
    if (!sessionId) {
      localStorage.removeItem(ACTIVE_SESSION_KEY)
      setVersions([])
      return
    }
    localStorage.setItem(ACTIVE_SESSION_KEY, sessionId)
    let cancelled = false
    api
      .getSessionVersions(sessionId)
      .then((r) => {
        if (cancelled) return
        const items = r.items
        setVersions(items)
        if (items.length > 0) {
          const latest = items[items.length - 1] as Record<string, unknown>
          const finalPrompt = String(latest.final_prompt || '')
          if (finalPrompt) {
            const techniqueIds = (Array.isArray(latest.techniques_used) ? latest.techniques_used : []) as string[]
            setResult({
              prompt_block: finalPrompt,
              reasoning: String(latest.reasoning || ''),
              has_prompt: true,
              has_questions: false,
              techniques: techniqueIds.map((id) => ({ id, name: id })),
              technique_ids: techniqueIds,
              task_types: (Array.isArray(latest.task_types) ? latest.task_types : []) as string[],
              complexity: String(latest.complexity || 'medium'),
              gen_model: String(latest.gen_model || ''),
              target_model: String(latest.target_model || 'unknown'),
              metrics: (typeof latest.metrics === 'object' && latest.metrics ? latest.metrics : {}) as Record<string, unknown>,
              session_id: sessionId,
            })
            const ti = String(latest.task_input || '')
            if (ti) {
              setTaskInput(ti)
              setBaseTaskRef(ti)
            }
          }
        }
      })
      .catch(() => {
        if (!cancelled) setVersions([])
      })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  useEffect(() => {
    if (creationMode !== 'agent' || !sessionId?.trim()) return
    const t = window.setTimeout(() => {
      saveSessionAgentChat(sessionId, chatMessages)
    }, 450)
    return () => window.clearTimeout(t)
  }, [creationMode, sessionId, chatMessages])

  useEffect(() => {
    if (!loading || creationMode !== 'agent') {
      setAgentThinkingIdx(0)
      return
    }
    setAgentThinkingIdx(Math.floor(Math.random() * AGENT_THINKING_PHASES.length))
    const id = window.setInterval(() => {
      setAgentThinkingIdx((i) => (i + 1) % AGENT_THINKING_PHASES.length)
    }, 2600)
    return () => window.clearInterval(id)
  }, [loading, creationMode])

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
      promptType,
    ].join('|')

    const timer = window.setTimeout(async () => {
      setPreviewLoading(true)
      try {
        const res = await api.previewPromptIde({
          task_input: taskInput,
          target_model: promptType === 'text' ? targetModel : 'unknown',
          workspace_id: workspaceId || null,
          previous_prompt: iterationMode ? result?.prompt_block : undefined,
          technique_mode: techniqueMode,
          manual_techs: manualTechs,
          overrides: ideOverrides,
          evidence_decisions: evidenceDecisions,
          prompt_type: promptType,
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
    promptType,
  ])

  const effectiveTargetModel = promptType === 'text' ? targetModel : 'unknown'

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
        target_model: effectiveTargetModel,
        domain: 'auto',
        technique_mode: techniqueMode,
        manual_techs: techniqueMode === 'manual' ? manualTechs : [],
        temperature,
        top_p: topP,
        prompt_type: promptType,
        top_k: topK === '' ? undefined : topK,
        questions_mode: questionsMode && !questionAnswers?.length,
        session_id: sessionId || undefined,
        previous_prompt: previousPrompt && previousPrompt.trim() ? previousPrompt : undefined,
        workspace_id: workspaceId || null,
        prompt_spec_overrides: ideOverrides,
        evidence_decisions: evidenceDecisions,
        question_answers: questionAnswers || [],
        image_prompt_tags: promptType === 'image' ? imagePromptTags : undefined,
        image_preset_id: promptType === 'image' && imagePresetId ? imagePresetId : undefined,
        image_engine: promptType === 'image' ? 'auto' : undefined,
        image_deep_mode: promptType === 'image' ? imageDeepMode : undefined,
        skill_preset_id: promptType === 'skill' && skillPresetId ? skillPresetId : undefined,
        recent_technique_ids: loadRecentTechniqueIds(),
      }
      const res = normalizeClientGenerateResult(await api.generate(req))
      appendRecentTechniqueIds(res.technique_ids || [])
      setResult(res)
      setSessionId(res.session_id)
      pushRecentSession(res.session_id, effectiveTask)
      setIterationMode(false)
      setQuestionState({})
      setQuestionCarouselIdx(0)
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
            if (res.technique_reasons?.length) {
              thinkingParts.push(
                res.technique_reasons
                  .map((tr) => `• **${tr.id}:** ${tr.reason.length > 200 ? `${tr.reason.slice(0, 200)}…` : tr.reason}`)
                  .join('\n'),
              )
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
                'Нужны уточнения: панель под чатом, листайте вопросы — на последнем шаге нажмите «Подтвердить».',
            })
          }
          queueMicrotask(() => {
            studioModesRef.current[promptType] = {
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
              imagePromptTags,
              imagePresetId,
              imageEngine,
              imageDeepMode,
              skillPresetId,
            }
            saveAgentDraftV2({
              activePromptType: promptType,
              modes: { ...studioModesRef.current },
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
    if (sessionId?.trim()) clearSessionAgentChat(sessionId)
    const fresh = createEmptyStudioSnapshot(promptType)
    studioModesRef.current[promptType] = fresh
    hydrateFromSnapshot(fresh)
    setChatInput('')
    setQuestionCarouselIdx(0)
    clearAgentDraftV2()
    setError(null)
    localStorage.removeItem(ACTIVE_SESSION_KEY)
  }

  const handleAgentSend = () => {
    const text = chatInput.trim()
    if (!text || loading) return
    if (result?.has_questions && !result?.has_prompt) {
      setError('Завершите уточнения в панели под чатом или нажмите «Подтвердить» на последнем вопросе.')
      return
    }
    setChatInput('')
    setChatMessages((m) => [...m, { id: crypto.randomUUID(), role: 'user', content: text }])
    setError(null)

    if (isConversationalOnlyMessage(text)) {
      if (result?.has_prompt) {
        setChatMessages((m) => [
          ...m,
          { id: crypto.randomUUID(), role: 'assistant', content: pickAfterPromptChatReply() },
        ])
        return
      }
      setChatMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: 'assistant', content: pickConversationalReply() },
      ])
      return
    }

    if (result?.has_prompt && result.prompt_block) {
      const taskRef = (baseTaskRef || taskInput).trim()
      const snapshot = result
      const tm = effectiveTargetModel
      const sidRef = sessionId

      void (async () => {
        const plan = await resolveAgentFollowUpPlan(text)
        const dbg =
          import.meta.env.DEV && plan.debug
            ? `\n\n\`\`\`text\n[Router] ${plan.type} · ${plan.debug}\n\`\`\``
            : ''

        const pushAssistant = (body: string) => {
          const content = body + dbg
          setChatMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', content }])
        }

        if (plan.type === 'iterate') {
          void handleGenerate(undefined, {
            taskInputOverride: taskRef,
            feedbackOverride: text,
            forceIteration: true,
            previousPromptOverride: snapshot.prompt_block,
          })
          return
        }

        if (plan.type === 'chat') {
          pushAssistant(plan.text)
          return
        }

        try {
          if (plan.type === 'save_library') {
            const title = plan.titleHint?.trim() || suggestLibraryTitle(taskRef)
            await api.saveToLibrary({
              title,
              prompt: snapshot.prompt_block,
              tags: plan.tags,
              target_model: tm,
              task_type: snapshot.task_types?.[0] || 'general',
              techniques: snapshot.technique_ids,
            })
            window.dispatchEvent(new CustomEvent('metaprompt-nav-refresh'))
            setQuickSaved(true)
            const tagStr = plan.tags.length ? ` Теги: ${plan.tags.join(', ')}.` : ''
            pushAssistant(`Сохранено в библиотеку как «${title}».${tagStr}`)
            return
          }
          if (plan.type === 'eval_prompt') {
            const { metrics } = await api.evaluatePrompt(snapshot.prompt_block, tm, promptType)
            const pretty = JSON.stringify(metrics, null, 2)
            pushAssistant(`Оценка текущего промпта (эвристика на сервере):\n\n\`\`\`json\n${pretty}\n\`\`\``)
            return
          }
          if (plan.type === 'show_versions') {
            const sid = snapshot.session_id || sidRef
            if (!sid) {
              pushAssistant('Нет активной сессии генерации — версии появятся после первого сохранённого промпта.')
              return
            }
            const { items } = await api.getSessionVersions(sid)
            if (!items.length) {
              pushAssistant('В этой сессии пока нет сохранённых версий.')
              return
            }
            const lines = items
              .map((row) => {
                const v = row as Record<string, unknown>
                return `• v${v.version} — ${String(v.created_at || '').slice(0, 19)}`
              })
              .join('\n')
            pushAssistant(`Версии в этой сессии:\n${lines}\n\nПереключать текущий текст можно таблетками **v1, v2…** под промптом справа.`)
            return
          }
          if (plan.type === 'nav_compare') {
            navigate('/compare', { state: { taskInput: taskRef } })
            pushAssistant('Открыта страница **Сравнение** с подставленной задачей.')
            return
          }
          if (plan.type === 'nav_library') {
            const q = plan.search?.trim()
            navigate(q ? `/library?search=${encodeURIComponent(q)}` : '/library')
            pushAssistant(q ? `Открыта библиотека с поиском «${q}».` : 'Открыта библиотека промптов.')
            return
          }
          if (plan.type === 'nav_skills') {
            navigate('/library?tab=skills')
            pushAssistant('Открыта вкладка **Скиллы** в библиотеке.')
            return
          }
        } catch (e) {
          pushAssistant(e instanceof Error ? e.message : 'Команда не выполнена.')
        }
      })()
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

  useEffect(() => {
    if (creationMode !== 'agent') return
    const t = window.setTimeout(() => {
      persistCurrentModeToRef()
      saveAgentDraftV2({
        activePromptType: promptType,
        modes: { ...studioModesRef.current },
      })
    }, 450)
    return () => window.clearTimeout(t)
  }, [
    creationMode,
    persistCurrentModeToRef,
    promptType,
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
    imagePresetId,
    imageEngine,
    imageDeepMode,
    skillPresetId,
  ])

  const handleSaveToLibrary = async () => {
    if (!result?.prompt_block) return
    const title = saveTitle.trim() || suggestLibraryTitle(taskInput)
    await api.saveToLibrary({
      title,
      prompt: result.prompt_block,
      tags: saveTags.split(',').map((t) => t.trim()).filter(Boolean),
      target_model: effectiveTargetModel,
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
      target_model: effectiveTargetModel,
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

  const communityPublishInitial: PublishToCommunityInitial = useMemo(
    () => ({
      title: suggestLibraryTitle(taskInput),
      prompt: result?.prompt_block || '',
      description: '',
      prompt_type: promptType === 'image' ? 'image' : promptType === 'skill' ? 'skill' : 'text',
      tags: [],
    }),
    [taskInput, result?.prompt_block, promptType],
  )

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

  const agentChatPlaceholder = useMemo(() => {
    if (promptType === 'image') {
      return 'Сначала опишите сцену или идею. Стили и уточнения — строкой выше, когда понадобятся.'
    }
    if (promptType === 'skill') {
      return 'Опишите, какой навык или инструкцию оформить для ИИ-ассистента (роль, шаги, формат ответа)…'
    }
    return 'Опишите задачу или попросите изменить промпт…'
  }, [promptType])

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
                <WorkspacePicker
                  workspaces={workspaces}
                  workspaceId={workspaceId}
                  onSelect={setWorkspaceId}
                  workspacesReady={workspacesReady}
                />
                {promptType !== 'image' ? (
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
                ) : null}
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

    const submitWizardAnswers = () =>
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

    return (
      <div
        className={`${styles.questionBox} ${compact ? styles.questionBoxCompact : ''} ${styles.questionCarousel} ${
          compact ? styles.wizardAgentMerged : styles.wizardShellCompact
        }`}
      >
        <div className={`${styles.wizardProgressWrap} ${compact ? styles.wizardProgressWrapTight : ''}`}>
          <div className={styles.wizardProgressBar}>
            <div className={styles.wizardProgressFill} style={{ width: `${((idx + 1) / total) * 100}%` }} />
          </div>
          <span className={styles.questionCarouselMeta}>
            {idx + 1} / {total}
          </span>
        </div>
        <div className={compact ? styles.wizardQuestionBlockAgent : styles.wizardScrollBody}>
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
        </div>
        <div className={`${styles.wizardFooter} ${compact ? styles.wizardFooterCompact : ''}`}>
          {compact ? (
            <div className={styles.wizardToolbar}>
              {idx > 0 ? (
                <button
                  type="button"
                  className={styles.wizIconBtn}
                  aria-label="Назад"
                  title="Назад"
                  onClick={() => setQuestionCarouselIdx((i) => Math.max(0, i - 1))}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M15 18l-6-6 6-6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              ) : (
                <span className={styles.wizToolbarLeadSpacer} aria-hidden />
              )}
              <button
                type="button"
                className={styles.wizTextBtn}
                disabled={loading}
                aria-label="Скип — без ответов на уточнения"
                title="Пропустить все уточнения и сгенерировать промпт"
                onClick={() => handleGenerate([], questionGenOpts)}
              >
                Скип
              </button>
              <span className={styles.wizToolbarGrow} aria-hidden />
              {idx < total - 1 ? (
                <button
                  type="button"
                  className={`${styles.wizIconBtn} ${styles.wizIconBtnPrimary}`}
                  aria-label={`Вперёд: вопрос ${idx + 2} из ${total}`}
                  title={`Вопрос ${idx + 2} из ${total}`}
                  onClick={() => setQuestionCarouselIdx((i) => Math.min(total - 1, i + 1))}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M9 18l6-6-6-6"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.wizCreateBtn}
                  disabled={loading}
                  title="Собрать ответы со всех шагов и сгенерировать промпт"
                  onClick={() => submitWizardAnswers()}
                >
                  Подтвердить
                </button>
              )}
            </div>
          ) : (
            <div className={styles.wizardNavUnified}>
              {idx > 0 ? (
                <button type="button" className="btn-ghost" onClick={() => setQuestionCarouselIdx((i) => Math.max(0, i - 1))}>
                  Назад
                </button>
              ) : null}
              <button type="button" className="btn-ghost" disabled={loading} onClick={() => handleGenerate([], questionGenOpts)}>
                Скип
              </button>
              {idx < total - 1 ? (
                <button
                  type="button"
                  className={`${styles.primaryAction} btn-primary ${styles.wizardNavUnifiedGrow}`}
                  onClick={() => setQuestionCarouselIdx((i) => Math.min(total - 1, i + 1))}
                >
                  Вперёд
                </button>
              ) : (
                <button
                  type="button"
                  className={`${styles.primaryAction} btn-primary ${styles.wizardNavUnifiedGrow}`}
                  disabled={loading}
                  title="Собрать ответы со всех шагов и сгенерировать промпт"
                  onClick={() => submitWizardAnswers()}
                >
                  Подтвердить
                </button>
              )}
            </div>
          )}
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
                  <button
                    type="button"
                    className={styles.quickSaveBtn}
                    title="Опубликовать в сообществе"
                    onClick={() => setPublishCommunityOpen(true)}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <circle cx="12" cy="12" r="10" />
                      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                  </button>
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
                  <div className={styles.tipsBoxHead}>
                    <strong>Что можно улучшить:</strong>
                    <button
                      type="button"
                      className={styles.tipsApplyAllBtn}
                      disabled={loading}
                      title="Вставить все советы в запрос на доработку одним действием"
                      onClick={() => {
                        const tips = result.metrics?.improvement_tips as string[]
                        const body = tips.map((t, i) => `${i + 1}. ${t}`).join('\n')
                        if (creationMode === 'agent') {
                          setChatInput(`Учти и примени советы по очереди:\n${body}`)
                        } else {
                          setFeedback(body)
                          setIterationMode(true)
                        }
                      }}
                    >
                      Применить всё
                    </button>
                  </div>
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
                  {result.metrics?.prompt_analysis_mode === 'image'
                    ? 'Оценка полноты для изображений: субъект, стиль, композиция, свет/палитра, негатив, техника (эвристика на сервере). Это не оценка художественного качества картинки.'
                    : 'Оценка полноты смотрит на структуру промпта (эвристика на устройстве/сервере), а не на ответ модели в чате. Перед важным использованием проверьте текст в своей модели.'}
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
      <FirstVisitHomeTip />
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
                  <div className={styles.promptTypeTabs}>
                    {(['text', 'image', 'skill'] as const).map((pt) => (
                      <button
                        key={pt}
                        type="button"
                        className={`${styles.promptTypeTab} ${promptType === pt ? styles.promptTypeTabActive : ''}`}
                        onClick={() => handlePromptTypeChange(pt)}
                      >
                        {pt === 'text' ? '📝 Текст' : pt === 'image' ? '📷 Фото' : '⚡ Скилл'}
                      </button>
                    ))}
                  </div>
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
              {promptType === 'image' && (
                <div className={styles.imageStyleToolbar}>
                  <div className={styles.imageStylesOneRow} aria-label="Выбранные стили изображения">
                    <div className={styles.imageSelectedWrap}>
                      {imagePromptTags.map((id) => {
                        const def = IMAGE_STYLES_BY_ID[id]
                        return (
                          <button
                            key={id}
                            type="button"
                            className={styles.imageSelectedChip}
                            onClick={() => toggleImageTag(id)}
                            title={def?.description ?? id}
                          >
                            {def?.label ?? id}
                          </button>
                        )
                      })}
                    </div>
                    <button
                      ref={imageStyleMoreBtnRef}
                      type="button"
                      className={styles.imageStyleMenuBtn}
                      title="Открыть каталог стилей"
                      aria-label="Каталог стилей изображения"
                      aria-expanded={imageStylePickerOpen}
                      aria-haspopup="listbox"
                      onClick={() => setImageStylePickerOpen((o) => !o)}
                    >
                      Стили
                    </button>
                  </div>
                  <button
                    type="button"
                    className={`${styles.imageDeepToggle} ${imageDeepMode ? styles.imageDeepToggleOn : ''}`}
                    aria-pressed={imageDeepMode}
                    title="Анализирует сцену и добавляет детали освещения, перспективы и атмосферы перед генерацией промпта. Дороже по токенам, обычно точнее."
                    onClick={() => setImageDeepMode((v) => !v)}
                  >
                    <span className={styles.imageDeepIcon} aria-hidden>
                      🔬
                    </span>
                    <span className={styles.imageDeepToggleText}>Анализ сцены</span>
                  </button>
                </div>
              )}
              {promptType === 'skill' && chatMessages.length === 0 ? (
                <div className={styles.skillQuickStart} aria-label="Быстрые шаблоны для скилла">
                  <span className={styles.skillQuickLabel}>Примеры</span>
                  <div className={styles.skillQuickChips}>
                    {[
                      ['Эксперт по финанализу', 'Скилл: ты — финансовый аналитик. Помогай с метриками и рисками. Формат: кратко, таблицы по запросу.\n\n'],
                      ['Редактор текстов', 'Скилл: редактор стиля. Улучшай ясность и тон, сохраняй смысл. Отвечай правками и кратким обоснованием.\n\n'],
                      ['Python-разработчик', 'Скилл: senior Python. Код с типами и тестами, объясняй шаги. Стиль: PEP8, без лишней воды.\n\n'],
                    ].map(([label, seed]) => (
                      <button
                        key={label}
                        type="button"
                        className={styles.skillQuickChip}
                        onClick={() => setChatInput(seed)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
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
                      <span className={styles.agentThinkingInner}>
                        {AGENT_THINKING_PHASES[agentThinkingIdx % AGENT_THINKING_PHASES.length]}
                      </span>
                    </div>
                  )}
                  {error && <p className={styles.error}>{error}</p>}
                </div>
              </div>
              <div
                className={`${styles.agentChatComposerHost} ${
                  result?.has_questions && !result?.has_prompt ? styles.agentComposerWithWizard : ''
                }`}
              >
                {result?.has_questions && !result?.has_prompt && (
                  <div className={styles.agentWizardInComposer} aria-label="Уточняющие вопросы">
                    {renderQuestionsPanel('agent')}
                  </div>
                )}
              <div
                className={`${cb.composer} ${
                  result?.has_questions && !result?.has_prompt ? styles.agentComposerShellMerged : ''
                }`}
              >
                <AutoTextarea
                  className={cb.composerTextarea}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder={agentChatPlaceholder}
                  minHeightPx={result?.has_questions && !result?.has_prompt ? 52 : 72}
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
                      <WorkspacePicker
                        workspaces={workspaces}
                        workspaceId={workspaceId}
                        onSelect={setWorkspaceId}
                        workspacesReady={workspacesReady}
                      />
                      {promptType === 'image' ? (
                        <SelectDropdown
                          value={imagePresetId}
                          options={imagePresetSelectOptions}
                          onChange={setImagePresetId}
                          aria-label="Пресет стиля для изображения"
                          variant="composer"
                          footerLink={{ to: '/presets', label: 'Создать пресет…' }}
                        />
                      ) : promptType === 'skill' ? (
                        <SelectDropdown
                          value={skillPresetId}
                          options={skillPresetSelectOptions}
                          onChange={setSkillPresetId}
                          aria-label="Пресет для генерации скилла"
                          variant="composer"
                          footerLink={{ to: '/presets', label: 'Создать пресет…' }}
                        />
                      ) : (
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
                      )}
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
      <PublishToCommunityModal
        key={`pub-${result?.session_id ?? 'x'}-${(result?.prompt_block || '').length}`}
        open={publishCommunityOpen}
        onClose={() => setPublishCommunityOpen(false)}
        initial={communityPublishInitial}
      />
      <ImageStylePickerPopover
        open={imageStylePickerOpen}
        onClose={() => setImageStylePickerOpen(false)}
        anchorRef={imageStyleMoreBtnRef}
        items={IMAGE_STYLES_ALL}
        selectedIds={imagePromptTags}
        onToggle={toggleImageTag}
        favoriteIds={imageStyleFavorites}
        onToggleFavorite={toggleImageStyleFavorite}
      />
    </div>
  )
}
