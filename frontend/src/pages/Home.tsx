import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  api,
  normalizeSuggestedStudioActions,
  type GenerateRequest,
  type GenerateResult,
  type GenerationIssue,
  type ImageMetaResponse,
  type OpenRouterModel,
  type SuggestedStudioAction,
  type UserPresetRecord,
  type Workspace,
} from '../api/client'
import AutoTextarea from '../components/AutoTextarea'
import menuStyles from '../components/DropdownMenu.module.css'
import MarkdownOutput from '../components/MarkdownOutput'
import PortalDropdown from '../components/PortalDropdown'
import SelectDropdown from '../components/SelectDropdown'
import WorkspacePicker from '../components/WorkspacePicker'
import FirstVisitHomeTip from '../components/FirstVisitHomeTip'
import { CopyIconButton, TryInGeminiButton } from '../components/PromptToolbarIcons'
import { pushRecentSession } from '../lib/recentSessions'
import { suggestLibraryTitle } from '../lib/libraryTitle'
import { clearAgentDraftV2, loadAgentDraftV2, saveAgentDraftV2 } from '../lib/agentDraft'
import {
  cloneAgentStudioSnapshot,
  createEmptyStudioSnapshot,
  defaultWelcomeForMode,
  type AgentStudioSnapshot,
  type ExpertLevel,
  type PromptStudioMode,
  type StudioAppliedTip,
} from '../lib/agentStudioModes'
import {
  clampExpertGenerationTemperature,
  EXPERT_GENERATION_TEMPERATURE_CAP,
  EXPERT_LEVEL_HINTS,
  EXPERT_LEVEL_LABELS,
  getExpertLevelPreset,
} from '../lib/expertLevelPresets'
import { getLevelBundleForExpertLevel } from '../lib/levelBundle'
import { filterManualTechsForReasoningModel, isReasoningModelId } from '../lib/modelReasoning'
import { SKILL_TARGET_ENV_OPTIONS } from '../lib/skillTargetEnv'
import { clearSessionAgentChat, loadSessionAgentChat, saveSessionAgentChat } from '../lib/sessionAgentChat'
import ImageStylePickerPopover from '../components/ImageStylePickerPopover'
import PublishToCommunityModal, { type PublishToCommunityInitial } from '../components/PublishToCommunityModal'
import {
  isConversationalOnlyMessage,
  pickAfterPromptChatReply,
  pickConversationalReply,
} from '../lib/conversationalGate'
import { looksLikeStrongEdit } from '../lib/agentFollowUp'
import { computeLineDiffOps } from '../lib/lineDiffLcs'
import { buildAgentChatHistory, resolveStudioFollowUpPlan } from '../lib/agentStudioProcessPlan'
import {
  COMPLETENESS_SCORE_TITLE,
  PROMPT_COST_TITLE,
  TECHNIQUES_COUNT_TITLE,
  TOKEN_ESTIMATE_TITLE,
} from '../lib/scoreTooltips'
import { IMAGE_STYLES_ALL, IMAGE_STYLES_BY_ID } from '../lib/imageStyles'
import { loadImageStyleFavoriteIds, saveImageStyleFavoriteIds } from '../lib/imageStyleFavorites'
import { appendRecentTechniqueIds, loadRecentTechniqueIds } from '../lib/recentTechniques'
import { appendLocalSkill, loadLocalSkills } from '../lib/localSkillsStore'
import { shortGenerationModelLabel } from '../utils/generationModelLabel'
import { buildPromptDoneCard } from '../lib/studioPromptDoneCard'
import type { PromptDoneCard } from '../lib/studioPromptDoneCard'
import checkboxList from '../styles/CheckboxOptionList.module.css'
import cb from '../styles/ComposerBar.module.css'
import styles from './Home.module.css'

const ACTIVE_WORKSPACE_KEY = 'prompt-engineer-active-workspace'
const ACTIVE_SESSION_KEY = 'prompt-engineer-active-prompt-session'
const HOME_AGENT_SPLIT_KEY = 'prompt-engineer-home-agent-split'

/** Если в ответе одновременно [PROMPT] и хвост [QUESTIONS], UI зависает в режиме вопросов. */
function normalizeClientGenerateResult(res: GenerateResult): GenerateResult {
  if (!res.has_prompt) return res
  return { ...res, has_questions: false, questions: [] }
}

function pickPromptTitle(res: GenerateResult | null, taskFallback: string): string {
  const m = res?.metrics?.prompt_title
  if (typeof m === 'string' && m.trim()) return m.trim()
  if (res?.prompt_title?.trim()) return res.prompt_title.trim()
  return suggestLibraryTitle(taskFallback)
}

function mergeStudioSkillTags(raw: string): string[] {
  const tags = raw.split(',').map((t) => t.trim()).filter(Boolean)
  const lower = new Set(tags.map((t) => t.toLowerCase()))
  if (!lower.has('скилл') && !lower.has('skill') && !lower.has('студия')) {
    tags.push('студия')
  }
  return tags
}

type GenChatMsg = {
  id: string
  role: 'user' | 'assistant'
  content: string
  clarificationQA?: { question: string; answers: string[] }[]
  promptDoneCard?: PromptDoneCard
  appliedTip?: StudioAppliedTip
  editPreviewCard?: {
    instruction: string
    oldPrompt: string
    newPrompt: string
    diffOps: ReturnType<typeof computeLineDiffOps>
  }
}

type DoneGenerationContext = {
  nextVersion: number
  isIteration: boolean
  previousPromptBlock?: string
  fromVersion?: number
  prevScore: number
  prevTokens: number
}

function buildDoneGenerationContext(
  prevMsgs: GenChatMsg[],
  versions: Record<string, unknown>[],
  isIteration: boolean,
  previousPrompt: string | undefined,
  prevResult: GenerateResult | null,
): DoneGenerationContext {
  const maxVer =
    versions.length > 0
      ? Math.max(...versions.map((v) => Number((v as Record<string, unknown>).version) || 0))
      : 0
  const maxFromChat = prevMsgs.reduce((acc, m) => Math.max(acc, m.promptDoneCard?.version ?? 0), 0)
  const base = Math.max(maxVer, maxFromChat)
  const nextVersion = base + 1
  const hasPrev = Boolean(isIteration && previousPrompt && previousPrompt.trim())
  return {
    nextVersion,
    isIteration: hasPrev,
    previousPromptBlock: hasPrev ? String(previousPrompt) : undefined,
    fromVersion: hasPrev ? base : undefined,
    prevScore: prevResult ? Number(prevResult.metrics?.completeness_score ?? prevResult.metrics?.quality_score ?? 0) : 0,
    prevTokens: prevResult ? Math.round(Number(prevResult.metrics?.token_estimate ?? 0)) : 0,
  }
}

function findPendingClarificationId(messages: GenChatMsg[]): string | null {
  const m = [...messages].reverse().find(
    (x) =>
      x.role === 'assistant' &&
      x.content.includes('Нужны уточнения') &&
      x.clarificationQA === undefined,
  )
  return m?.id ?? null
}

/** Сообщения чата после ответа генерации (без учёта смены вкладки). */
function computeChatAfterGeneration(
  prev: GenChatMsg[],
  res: GenerateResult,
  questionAnswers: { question: string; answers: string[] }[] | undefined,
  doneCtx: DoneGenerationContext,
): { next: GenChatMsg[]; lastClarificationsMsgId: string | null } {
  let next: GenChatMsg[] = [...prev]
  let lastClarificationsMsgId: string | null = null
  const pendingId = findPendingClarificationId(prev)
  if (questionAnswers !== undefined && pendingId) {
    next = next.map((m) => (m.id === pendingId ? { ...m, clarificationQA: questionAnswers } : m))
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
      content: '',
      promptDoneCard: buildPromptDoneCard(res, {
        nextVersion: doneCtx.nextVersion,
        isIteration: doneCtx.isIteration,
        previousPromptBlock: doneCtx.previousPromptBlock,
        fromVersion: doneCtx.fromVersion,
        prevScore: doneCtx.prevScore,
        prevTokens: doneCtx.prevTokens,
      }),
    })
  } else if (res.has_questions && (res.questions?.length || 0) > 0) {
    const cid = crypto.randomUUID()
    lastClarificationsMsgId = cid
    next.push({
      id: cid,
      role: 'assistant',
      content:
        'Нужны уточнения: панель под чатом, листайте вопросы — на последнем шаге нажмите «Подтвердить».',
    })
  }
  return { next, lastClarificationsMsgId }
}

function clampSplit(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/** Ротация фраз в студии во время генерации */
const AGENT_THINKING_PHASES = [
  'Разбираю формулировку задачи…',
  'Сопоставляю с типом задачи и контекстом…',
  'Подбираю техники и структуру ответа…',
  'Продумываю уточнения и ограничения…',
  'Собираю формулировку промпта…',
  'Проверяю согласованность и полноту…',
]

const PRE_PROMPT_ROUTING_LINE = 'Определяю намерение реплики (лёгкий семантический разбор, без LLM)…'
const PRE_PROMPT_TASK_LINE = 'Намерение: задача на промпт — подключаю генерацию…'
const PRE_PROMPT_SKILL_LINE = 'Намерение: оформление скилла — подключаю генерацию…'

const AGENT_PROCESS_PRE_TIMEOUT_MS = 15_000

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
  promptDoneCard?: PromptDoneCard
  appliedTip?: StudioAppliedTip
  editPreviewCard?: GenChatMsg['editPreviewCard']
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
  const [versions, setVersions] = useState<Record<string, unknown>[]>([])
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [saveTitle, setSaveTitle] = useState('')
  const [saveTags, setSaveTags] = useState('')
  const [saveNotes, setSaveNotes] = useState('')
  const [questionState, setQuestionState] = useState<Record<number, { options: string[]; custom: string }>>({})
  const [showIdeModal, setShowIdeModal] = useState(false)
  const [modelsData, setModelsData] = useState<OpenRouterModel[]>([])
  const [preferredTargetModels, setPreferredTargetModels] = useState<string[]>(['unknown'])
  const [targetModel, setTargetModel] = useState('unknown')
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
  const [skillTargetEnv, setSkillTargetEnv] = useState('generic')
  const [skillBody, setSkillBody] = useState('')
  const [expertLevel, setExpertLevel] = useState<ExpertLevel>('mid')
  const [baseTaskRef, setBaseTaskRef] = useState('')
  const [questionCarouselIdx, setQuestionCarouselIdx] = useState(0)
  const [quickSaved, setQuickSaved] = useState(false)
  const [suggestedActions, setSuggestedActions] = useState<SuggestedStudioAction[]>([])
  const [suggestionsBarExpanded, setSuggestionsBarExpanded] = useState(false)
  const [versionRestoreConfirm, setVersionRestoreConfirm] = useState<{ version: number; prompt: string } | null>(null)
  /** Панель уточняющих вопросов: сворачиваем при старте генерации, можно развернуть по клику. */
  const [questionFollowupOpen, setQuestionFollowupOpen] = useState(true)
  /** Hover по чипу «Совет N» в карточке результата — текст показывается строкой под чипами. */
  const [hoveredPromptSuggestion, setHoveredPromptSuggestion] = useState<{
    msgId: string
    index: number
  } | null>(null)
  /** Снимки студии по вкладкам «Текст / Фото / Скилл» — при переключении не смешиваем чаты и сессии. */
  const studioModesRef = useRef<Record<PromptStudioMode, AgentStudioSnapshot>>({
    text: cloneAgentStudioSnapshot(createEmptyStudioSnapshot('text')),
    image: cloneAgentStudioSnapshot(createEmptyStudioSnapshot('image')),
    skill: cloneAgentStudioSnapshot(createEmptyStudioSnapshot('skill')),
  })

  const applyExpertPreset = useCallback((level: ExpertLevel, mode: PromptStudioMode) => {
    const p = getExpertLevelPreset(level, mode)
    setQuestionsMode(p.questionsMode)
    setTechniqueMode(p.techniqueMode)
    setManualTechs(p.manualTechs)
    setTemperature(p.temperature)
    setTopP(p.topP)
    if (p.imageDeepMode !== undefined) setImageDeepMode(p.imageDeepMode)
  }, [])

  const hydrateFromSnapshot = useCallback(
    (s: AgentStudioSnapshot, targetMode?: PromptStudioMode) => {
    const fresh = cloneAgentStudioSnapshot(s)
    setChatMessages(fresh.chatMessages as ChatMessage[])
    setTaskInput(fresh.taskInput)
    setBaseTaskRef(fresh.baseTaskRef)
    setFeedback(fresh.feedback)
    setResult(fresh.result)
    setSessionId(fresh.sessionId)
    setIterationMode(fresh.iterationMode)
    setQuestionState(fresh.questionState)
    setQuestionCarouselIdx(fresh.questionCarouselIdx)
    setQuickSaved(fresh.quickSaved)
    const lvl = fresh.expertLevel ?? 'mid'
    setExpertLevel(lvl)
    const modeForPreset = targetMode ?? promptTypeRef.current
    applyExpertPreset(lvl, modeForPreset)
    setImagePromptTags(fresh.imagePromptTags)
    setImagePresetId(fresh.imagePresetId)
    setImageEngine(fresh.imageEngine)
    setImageDeepMode(fresh.imageDeepMode)
    setSkillPresetId(fresh.skillPresetId)
    setSkillTargetEnv(typeof fresh.skillTargetEnv === 'string' && fresh.skillTargetEnv ? fresh.skillTargetEnv : 'generic')
    setSkillBody(typeof fresh.skillBody === 'string' ? fresh.skillBody : '')
    const pendingClar = [...fresh.chatMessages]
      .reverse()
      .find(
        (m) =>
          m.role === 'assistant' &&
          m.content.includes('Нужны уточнения') &&
          m.clarificationQA === undefined,
      )
    lastClarificationsMsgIdRef.current = pendingClar?.id ?? null
    setSuggestedActions(fresh.suggestedActions ?? [])
  },
    [applyExpertPreset],
  )

  const persistCurrentModeToRef = useCallback(() => {
    studioModesRef.current[promptType] = cloneAgentStudioSnapshot({
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
      skillTargetEnv,
      skillBody,
      expertLevel,
      suggestedActions,
    })
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
    skillTargetEnv,
    skillBody,
    expertLevel,
    suggestedActions,
  ])

  const handlePromptTypeChange = useCallback(
    (next: PromptStudioMode) => {
      if (loading) return
      if (next === promptType) return
      persistCurrentModeToRef()
      const incoming = cloneAgentStudioSnapshot(studioModesRef.current[next])
      hydrateFromSnapshot(incoming, next)
      setPromptType(next)
      if (incoming.sessionId?.trim()) {
        localStorage.setItem(ACTIVE_SESSION_KEY, incoming.sessionId)
      } else {
        localStorage.removeItem(ACTIVE_SESSION_KEY)
      }
      setError(null)
      setIssueBannerDismissed(false)
    },
    [promptType, persistCurrentModeToRef, hydrateFromSnapshot, loading],
  )

  const handleExpertLevelChange = useCallback(
    (level: ExpertLevel) => {
      if (loading) return
      setExpertLevel(level)
      applyExpertPreset(level, promptType)
      studioModesRef.current[promptType] = cloneAgentStudioSnapshot({
        ...studioModesRef.current[promptType],
        expertLevel: level,
      })
    },
    [promptType, applyExpertPreset, loading],
  )

  const agentSplitRootRef = useRef<HTMLDivElement>(null)
  const agentChatScrollRef = useRef<HTMLDivElement>(null)
  const imageStyleMoreBtnRef = useRef<HTMLButtonElement>(null)
  const [issueBannerDismissed, setIssueBannerDismissed] = useState(false)
  const lastQuestionAnswersRef = useRef<{ question: string; answers: string[] }[] | undefined>(undefined)
  const lastClarificationsMsgIdRef = useRef<string | null>(null)
  const agentStudioBootstrappedRef = useRef(false)
  const restoredFromSidebarRef = useRef(false)
  const [agentThinkingIdx, setAgentThinkingIdx] = useState(0)
  /** Фиксированная строка «думает» (роутинг / этап); если null — ротация AGENT_THINKING_PHASES */
  const [agentThinkingLine, setAgentThinkingLine] = useState<string | null>(null)
  const [publishCommunityOpen, setPublishCommunityOpen] = useState(false)
  const [skillSandboxOpen, setSkillSandboxOpen] = useState(false)
  const [skillSandboxInput, setSkillSandboxInput] = useState('')
  const [skillSandboxLog, setSkillSandboxLog] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [skillSandboxBusy, setSkillSandboxBusy] = useState(false)
  const [promptPlaygroundOpen, setPromptPlaygroundOpen] = useState(false)
  const [promptPlaygroundInput, setPromptPlaygroundInput] = useState('')
  const [promptPlaygroundLog, setPromptPlaygroundLog] = useState<{ role: 'user' | 'assistant'; content: string }[]>(
    [],
  )
  const [promptPlaygroundBusy, setPromptPlaygroundBusy] = useState(false)
  const prevGenModelForReasoningRef = useRef<string>('')
  const techPickerBtnRef = useRef<HTMLButtonElement>(null)
  const [techPickerOpen, setTechPickerOpen] = useState(false)
  const [techMenuFilter, setTechMenuFilter] = useState('')
  const skillInsertBtnRef = useRef<HTMLButtonElement>(null)
  const [skillInsertOpen, setSkillInsertOpen] = useState(false)
  const [localSkillsTick, setLocalSkillsTick] = useState(0)
  const [skillTestRunning, setSkillTestRunning] = useState(false)
  const [skillTestResults, setSkillTestResults] = useState<Record<number, 'pass' | 'fail'>>({})
  /** Токены только текста задачи (baseTaskRef || taskInput), без system и без истории чата */
  const [taskTextTokens, setTaskTextTokens] = useState<{ tokens: number; method: string } | null>(null)
  const [taskTextTokensLoading, setTaskTextTokensLoading] = useState(false)
  const promptTypeRef = useRef(promptType)
  useEffect(() => {
    promptTypeRef.current = promptType
  }, [promptType])

  useEffect(() => {
    const fn = () => setLocalSkillsTick((x) => x + 1)
    window.addEventListener('metaprompt-nav-refresh', fn)
    return () => window.removeEventListener('metaprompt-nav-refresh', fn)
  }, [])

  useLayoutEffect(() => {
    if (!techPickerOpen) setTechMenuFilter('')
  }, [techPickerOpen])

  const localSkillsForPicker = useMemo(() => loadLocalSkills(), [localSkillsTick])

  const GENERATION_ISSUE_TEXT: Record<GenerationIssue, string> = {
    format_failure:
      'Ответ модели не удалось разобрать: нет распознаваемых блоков [PROMPT] и [QUESTIONS]. Часто так бывает, если модель генерации нарушила формат. Попробуйте снова или выберите другую модель.',
    questions_unparsed:
      'Блок вопросов в ответе есть, но список не разобрался. Ниже можно открыть полный текст ответа или повторить генерацию.',
    weak_question_options:
      'Вопросы распознаны, но почти без вариантов ответа (остались заглушки). Имеет смысл повторить генерацию или заполнить поле «Свой ответ».',
    iteration_with_questions:
      'При доработке промпта модель вернула блок вопросов вместо обновлённого [PROMPT]. Повторите генерацию или сформулируйте правку конкретнее.',
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
      const restored = stored as ChatMessage[]
      setChatMessages(restored)
      studioModesRef.current.text = cloneAgentStudioSnapshot({
        ...studioModesRef.current.text,
        chatMessages: restored,
        sessionId: sid,
      })
      const pendingClar = [...restored]
        .reverse()
        .find(
          (m) =>
            m.role === 'assistant' &&
            m.content.includes('Нужны уточнения') &&
            m.clarificationQA === undefined,
        )
      lastClarificationsMsgIdRef.current = pendingClar?.id ?? null
    } else {
      const w: ChatMessage[] = [{ id: 'welcome', role: 'assistant', content: defaultWelcomeForMode('text') }]
      setChatMessages(w)
      studioModesRef.current.text = cloneAgentStudioSnapshot({
        ...studioModesRef.current.text,
        chatMessages: w,
        sessionId: sid,
      })
      lastClarificationsMsgIdRef.current = null
    }
    navigate(location.pathname, { replace: true, state: null })
  }, [location.state, location.pathname, navigate])

  useEffect(() => {
    if (agentStudioBootstrappedRef.current) return
    if (restoredFromSidebarRef.current) {
      agentStudioBootstrappedRef.current = true
      restoredFromSidebarRef.current = false
      return
    }
    agentStudioBootstrappedRef.current = true
    const draft = loadAgentDraftV2()
    if (draft) {
      studioModesRef.current = {
        text: cloneAgentStudioSnapshot(draft.modes.text),
        image: cloneAgentStudioSnapshot(draft.modes.image),
        skill: cloneAgentStudioSnapshot(draft.modes.skill),
      }
      setPromptType(draft.activePromptType)
      hydrateFromSnapshot(studioModesRef.current[draft.activePromptType], draft.activePromptType)
      const sid = draft.modes[draft.activePromptType].sessionId
      if (sid?.trim()) localStorage.setItem(ACTIVE_SESSION_KEY, sid)
      else localStorage.removeItem(ACTIVE_SESSION_KEY)
      return
    }
    setChatMessages((msgs) => {
      if (msgs.length > 0) return msgs
      const w: ChatMessage[] = [{ id: 'welcome', role: 'assistant', content: defaultWelcomeForMode('text') }]
      studioModesRef.current.text = cloneAgentStudioSnapshot({
        ...studioModesRef.current.text,
        chatMessages: w,
      })
      return w
    })
  }, [hydrateFromSnapshot])

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
      const prefillMsgs: ChatMessage[] = [
        { id: 'welcome', role: 'assistant', content: defaultWelcomeForMode('text') },
        { id: crypto.randomUUID(), role: 'user', content: t },
      ]
      setChatMessages(prefillMsgs)
      studioModesRef.current.text = cloneAgentStudioSnapshot({
        ...studioModesRef.current.text,
        taskInput: t,
        baseTaskRef: t,
        chatMessages: prefillMsgs,
      })
      if (state.clearResult) setResult(null)
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [location.pathname, location.state, navigate])

  useEffect(() => {
    const state = location.state as { studioForkSkill?: { body: string; title?: string } } | null
    if (!state?.studioForkSkill) return
    const raw = (state.studioForkSkill.body || '').trim()
    const title = (state.studioForkSkill.title || '').trim()
    if (!raw) {
      navigate(location.pathname, { replace: true, state: null })
      return
    }
    const seed = title
      ? `Оформи и улучши скилл «${title}» (текст ниже уже в контексте skill_body).`
      : 'Доработай скилл из библиотеки (текст в контексте skill_body).'
    const welcomeSkill: ChatMessage[] = [
      { id: 'welcome', role: 'assistant', content: defaultWelcomeForMode('skill') },
      { id: crypto.randomUUID(), role: 'user', content: seed },
    ]
    const snap: AgentStudioSnapshot = {
      ...createEmptyStudioSnapshot('skill'),
      ...studioModesRef.current.skill,
      skillBody: raw,
      taskInput: seed,
      baseTaskRef: seed,
      chatMessages: welcomeSkill,
      result: null,
      sessionId: null,
      suggestedActions: [],
    }
    studioModesRef.current.skill = cloneAgentStudioSnapshot(snap)
    hydrateFromSnapshot(snap, 'skill')
    setPromptType('skill')
    setResult(null)
    setSessionId(null)
    localStorage.removeItem(ACTIVE_SESSION_KEY)
    navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, navigate, hydrateFromSnapshot])

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
    if (!sessionId?.trim()) return
    const t = window.setTimeout(() => {
      saveSessionAgentChat(sessionId, chatMessages)
    }, 450)
    return () => window.clearTimeout(t)
  }, [sessionId, chatMessages])

  useEffect(() => {
    if (!loading) {
      setAgentThinkingIdx(0)
      return
    }
    if (agentThinkingLine) {
      return
    }
    setAgentThinkingIdx(Math.floor(Math.random() * AGENT_THINKING_PHASES.length))
    const id = window.setInterval(() => {
      setAgentThinkingIdx((i) => (i + 1) % AGENT_THINKING_PHASES.length)
    }, 2600)
    return () => window.clearInterval(id)
  }, [loading, agentThinkingLine])

  useEffect(() => {
    setQuestionCarouselIdx(0)
  }, [result?.has_questions, result?.questions])

  useEffect(() => {
    const el = agentChatScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [chatMessages, result?.has_questions, result?.questions, loading, error])

  const effectiveTargetModel = useMemo(() => {
    if (promptType === 'text' || promptType === 'skill') return targetModel
    if (promptType === 'image') return (genModel && genModel.trim()) || 'unknown'
    return 'unknown'
  }, [promptType, targetModel, genModel])

  useEffect(() => {
    const prev = prevGenModelForReasoningRef.current
    prevGenModelForReasoningRef.current = genModel
    if (!isReasoningModelId(genModel)) return
    if (isReasoningModelId(prev)) return
    setTemperature((t) => Math.min(t, 0.45))
    setManualTechs((ids) => filterManualTechsForReasoningModel(ids))
    setQuestionsMode(false)
  }, [genModel])

  useEffect(() => {
    const task = (baseTaskRef || taskInput).trim()
    if (!task) {
      setTaskTextTokens(null)
      setTaskTextTokensLoading(false)
      return
    }
    const timer = window.setTimeout(() => {
      setTaskTextTokensLoading(true)
      void api
        .countTokens(task, genModel || undefined)
        .then((r) => setTaskTextTokens({ tokens: r.tokens, method: r.method }))
        .catch(() => setTaskTextTokens(null))
        .finally(() => setTaskTextTokensLoading(false))
    }, 400)
    return () => window.clearTimeout(timer)
  }, [baseTaskRef, taskInput, genModel])

  type GenerateOptions = {
    taskInputOverride?: string
    feedbackOverride?: string
    forceIteration?: boolean
    previousPromptOverride?: string
    skipAgentChatReplies?: boolean
    /** Сообщения, добавляемые в чат до блоков «размышления» / карточки результата (например «применён совет»). */
    chatAppendBeforeResult?: GenChatMsg[]
    /** Вызов из пре-роутера: loading уже true, guard на loading не применять */
    fromPrePromptRouter?: boolean
  }

  const handleGenerate = async (
    questionAnswers?: { question: string; answers: string[] }[],
    opts?: GenerateOptions,
  ) => {
    if (loading && !opts?.fromPrePromptRouter) return
    const requestPromptType = promptType
    const effectiveTask = (opts?.taskInputOverride ?? taskInput).trim()
    if (!effectiveTask) return
    lastQuestionAnswersRef.current = questionAnswers
    setIssueBannerDismissed(false)
    setSuggestedActions([])
    setSuggestionsBarExpanded(false)
    setLoading(true)
    if (!opts?.fromPrePromptRouter) {
      setAgentThinkingLine(null)
    }
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
        temperature: clampExpertGenerationTemperature(temperature),
        top_p: topP,
        prompt_type: promptType,
        top_k: topK === '' ? undefined : topK,
        questions_mode: questionsMode && !questionAnswers?.length,
        session_id: sessionId || undefined,
        previous_prompt: previousPrompt && previousPrompt.trim() ? previousPrompt : undefined,
        workspace_id: workspaceId || null,
        prompt_spec_overrides: {},
        evidence_decisions: {},
        question_answers: questionAnswers || [],
        image_prompt_tags: promptType === 'image' ? imagePromptTags : undefined,
        image_preset_id: promptType === 'image' && imagePresetId ? imagePresetId : undefined,
        image_engine: promptType === 'image' ? 'auto' : undefined,
        image_deep_mode: promptType === 'image' ? imageDeepMode : undefined,
        skill_preset_id: promptType === 'skill' && skillPresetId ? skillPresetId : undefined,
        skill_target_env: promptType === 'skill' ? skillTargetEnv : undefined,
        skill_body: skillBody.trim() || undefined,
        recent_technique_ids: loadRecentTechniqueIds(),
        expert_level: expertLevel,
      }
      setAgentThinkingLine(null)
      const res = normalizeClientGenerateResult(await api.generate(req))
      const nextSuggestions = normalizeSuggestedStudioActions(res.suggested_actions)
      setSuggestedActions(nextSuggestions)
      appendRecentTechniqueIds(res.technique_ids || [])
      pushRecentSession(res.session_id, effectiveTask, pickPromptTitle(res, effectiveTask))

      if (promptTypeRef.current !== requestPromptType) {
        const snap = studioModesRef.current[requestPromptType]
        if (opts?.skipAgentChatReplies) {
          studioModesRef.current[requestPromptType] = cloneAgentStudioSnapshot({
            ...snap,
            result: res,
            sessionId: res.session_id,
            iterationMode: false,
            questionState: {},
            questionCarouselIdx: 0,
            quickSaved: false,
            skillBody,
            skillTargetEnv,
            expertLevel,
            suggestedActions: nextSuggestions,
          })
        } else {
          let prevMsgs = (snap.chatMessages || []) as GenChatMsg[]
          if (opts?.chatAppendBeforeResult?.length) {
            prevMsgs = [...prevMsgs, ...opts.chatAppendBeforeResult]
          }
          const snapTarget = studioModesRef.current[requestPromptType]
          const doneCtx = buildDoneGenerationContext(
            prevMsgs,
            versions,
            isIteration,
            previousPrompt,
            snapTarget.result,
          )
          const { next: nextMsgs } = computeChatAfterGeneration(prevMsgs, res, questionAnswers, doneCtx)
          studioModesRef.current[requestPromptType] = cloneAgentStudioSnapshot({
            ...snap,
            chatMessages: nextMsgs as ChatMessage[],
            result: res,
            sessionId: res.session_id,
            iterationMode: false,
            questionState: {},
            questionCarouselIdx: 0,
            quickSaved: false,
            skillBody,
            skillTargetEnv,
            expertLevel,
            suggestedActions: nextSuggestions,
          })
        }
        saveAgentDraftV2({
          activePromptType: promptType,
          modes: {
            text: cloneAgentStudioSnapshot(studioModesRef.current.text),
            image: cloneAgentStudioSnapshot(studioModesRef.current.image),
            skill: cloneAgentStudioSnapshot(studioModesRef.current.skill),
          },
        })
        return
      }

      setResult(res)
      setSessionId(res.session_id)
      setIterationMode(false)
      setQuestionState({})
      setQuestionCarouselIdx(0)
      setQuickSaved(false)
      if (!opts?.skipAgentChatReplies) {
        setChatMessages((prev) => {
          let base = prev as GenChatMsg[]
          if (opts?.chatAppendBeforeResult?.length) {
            base = [...base, ...opts.chatAppendBeforeResult]
          }
          const doneCtx = buildDoneGenerationContext(
            base,
            versions,
            isIteration,
            previousPrompt,
            result,
          )
          const { next, lastClarificationsMsgId } = computeChatAfterGeneration(
            base,
            res,
            questionAnswers,
            doneCtx,
          )
          lastClarificationsMsgIdRef.current = lastClarificationsMsgId
          queueMicrotask(() => {
            studioModesRef.current[requestPromptType] = cloneAgentStudioSnapshot({
              chatMessages: next as ChatMessage[],
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
              skillTargetEnv,
              skillBody,
              expertLevel,
              suggestedActions: nextSuggestions,
            })
            saveAgentDraftV2({
              activePromptType: promptType,
              modes: {
                text: cloneAgentStudioSnapshot(studioModesRef.current.text),
                image: cloneAgentStudioSnapshot(studioModesRef.current.image),
                skill: cloneAgentStudioSnapshot(studioModesRef.current.skill),
              },
            })
          })
          return next as ChatMessage[]
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка генерации')
    } finally {
      setAgentThinkingLine(null)
      setLoading(false)
    }
  }

  const handleSuggestedActionClick = async (item: SuggestedStudioAction) => {
    if (!result?.has_prompt || !result.prompt_block?.trim() || loading) return
    const taskRef = (baseTaskRef || taskInput).trim()
    if (!taskRef) return
    const snapshot = result
    const tm = effectiveTargetModel

    const pushAssistant = (body: string) => {
      setChatMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: body }])
    }

    if (item.action === 'iterate') {
      const fb = item.data?.feedback?.trim() || item.title
      void handleGenerate(undefined, {
        taskInputOverride: taskRef,
        feedbackOverride: fb,
        forceIteration: true,
        previousPromptOverride: snapshot.prompt_block,
      })
      return
    }
    if (item.action === 'save_library') {
      try {
        const title = pickPromptTitle(snapshot, taskRef)
        if (promptType === 'skill') {
          appendLocalSkill({
            title,
            body: snapshot.prompt_block,
            description: taskRef.slice(0, 500),
            tags: mergeStudioSkillTags(''),
            frameworks: [],
          })
          window.dispatchEvent(new CustomEvent('metaprompt-nav-refresh'))
          setQuickSaved(true)
          pushAssistant(`Сохранено в **локальные скиллы** как «${title}». Откройте Библиотека → Скиллы.`)
        } else {
          await api.saveToLibrary({
            title,
            prompt: snapshot.prompt_block,
            tags: [],
            target_model: tm,
            task_type: snapshot.task_types?.[0] || 'general',
            techniques: snapshot.technique_ids,
          })
          window.dispatchEvent(new CustomEvent('metaprompt-nav-refresh'))
          setQuickSaved(true)
          pushAssistant(`Сохранено в библиотеку как «${title}».`)
        }
      } catch (e) {
        pushAssistant(e instanceof Error ? e.message : 'Не удалось сохранить.')
      }
      return
    }
    if (item.action === 'eval_prompt') {
      try {
        const { metrics } = await api.evaluatePrompt(snapshot.prompt_block, tm, promptType)
        const pretty = JSON.stringify(metrics, null, 2)
        pushAssistant(`Оценка текущего промпта (эвристика на сервере):\n\n\`\`\`json\n${pretty}\n\`\`\``)
      } catch (e) {
        pushAssistant(e instanceof Error ? e.message : 'Оценка не выполнена.')
      }
      return
    }
    if (item.action === 'nav_compare') {
      navigate('/compare', { state: { taskInput: taskRef } })
      pushAssistant('Открыта страница **Сравнение** с подставленной задачей.')
    }
  }

  const handleEditPreviewApply = async (msgId: string, newPrompt: string) => {
    const sid = (sessionId || result?.session_id || '').trim()
    if (!sid) {
      setError('Нет активной сессии — сначала сгенерируйте промпт, чтобы появились версии.')
      return
    }
    setError(null)
    setLoading(true)
    try {
      await api.applySessionPrompt(sid, { final_prompt: newPrompt })
      const { items } = await api.getSessionVersions(sid)
      setVersions(items)
      const latest = items.length ? (items[items.length - 1] as Record<string, unknown>) : null
      if (latest) {
        const fp = String(latest.final_prompt || '')
        const techniqueIds = (Array.isArray(latest.techniques_used) ? latest.techniques_used : []) as string[]
        setResult((prev) =>
          prev
            ? {
                ...prev,
                prompt_block: fp,
                has_prompt: true,
                has_questions: false,
                techniques: techniqueIds.map((id) => ({ id, name: id })),
                technique_ids: techniqueIds,
                reasoning: String(latest.reasoning || prev.reasoning),
                metrics:
                  typeof latest.metrics === 'object' && latest.metrics
                    ? (latest.metrics as Record<string, unknown>)
                    : prev.metrics,
              }
            : null,
        )
      }
      setChatMessages((prev) => prev.filter((x) => x.id !== msgId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось применить правку.')
    } finally {
      setLoading(false)
    }
  }

  const handleEditPreviewCancel = (msgId: string) => {
    setChatMessages((prev) => prev.filter((x) => x.id !== msgId))
  }

  const runSkillTestCases = async (cases: NonNullable<PromptDoneCard['skillTestCases']>) => {
    const skill = (result?.prompt_block || '').trim()
    if (!skill || skillTestRunning) return
    setSkillTestRunning(true)
    setSkillTestResults({})
    const acc: Record<number, 'pass' | 'fail'> = {}
    try {
      for (let i = 0; i < cases.length; i++) {
        const c = cases[i]!
        try {
          const r = await api.skillSandboxChat({
            skill_body: skill,
            user_message: c.user,
            gen_model: genModel || undefined,
          })
          const ok = r.reply.toLowerCase().includes(c.expect_substring.toLowerCase())
          acc[i] = ok ? 'pass' : 'fail'
        } catch {
          acc[i] = 'fail'
        }
        setSkillTestResults({ ...acc })
      }
    } finally {
      setSkillTestRunning(false)
    }
  }

  const sendPromptPlaygroundMessage = async () => {
    const promptText = (result?.prompt_block || '').trim()
    const q = promptPlaygroundInput.trim()
    if (!promptText || !q || promptPlaygroundBusy) return
    setPromptPlaygroundBusy(true)
    setPromptPlaygroundLog((prev) => [...prev, { role: 'user', content: q }])
    setPromptPlaygroundInput('')
    try {
      const r = await api.playgroundRun({
        prompt_text: promptText,
        user_input: q,
        gen_model: genModel || undefined,
        temperature: 0.5,
      })
      setPromptPlaygroundLog((prev) => [...prev, { role: 'assistant', content: r.reply }])
    } catch (e) {
      setPromptPlaygroundLog((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Ошибка: ${e instanceof Error ? e.message : 'сбой запроса'}`,
        },
      ])
    } finally {
      setPromptPlaygroundBusy(false)
    }
  }

  const sendSkillSandboxMessage = async () => {
    const skill = (result?.prompt_block || '').trim()
    const q = skillSandboxInput.trim()
    if (!skill || !q || skillSandboxBusy) return
    setSkillSandboxBusy(true)
    setSkillSandboxLog((prev) => [...prev, { role: 'user', content: q }])
    setSkillSandboxInput('')
    try {
      const r = await api.skillSandboxChat({
        skill_body: skill,
        user_message: q,
        gen_model: genModel || undefined,
      })
      setSkillSandboxLog((prev) => [...prev, { role: 'assistant', content: r.reply }])
    } catch (e) {
      setSkillSandboxLog((prev) => [
        ...prev,
        { role: 'assistant', content: e instanceof Error ? e.message : 'Ошибка запроса' },
      ])
    } finally {
      setSkillSandboxBusy(false)
    }
  }

  const handleRetryGeneration = () => {
    const qa = lastQuestionAnswersRef.current
    const taskOverride = (baseTaskRef || taskInput).trim() || undefined
    void handleGenerate(qa !== undefined ? qa : undefined, taskOverride ? { taskInputOverride: taskOverride } : undefined)
  }

  const resetAgentDialog = () => {
    if (loading) return
    if (sessionId?.trim()) clearSessionAgentChat(sessionId)
    const fresh = cloneAgentStudioSnapshot(createEmptyStudioSnapshot(promptType))
    studioModesRef.current[promptType] = fresh
    hydrateFromSnapshot(fresh, promptType)
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

      if (looksLikeStrongEdit(text)) {
        void (async () => {
          setLoading(true)
          setError(null)
          try {
            const r = await api.previewPromptEdit({
              task_input: taskRef,
              current_prompt: snapshot.prompt_block,
              instruction: text,
              prompt_type: promptType,
              gen_model: genModel || undefined,
            })
            const diffOps = computeLineDiffOps(snapshot.prompt_block, r.new_prompt)
            setChatMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: 'assistant',
                content: '',
                editPreviewCard: {
                  instruction: text,
                  oldPrompt: snapshot.prompt_block,
                  newPrompt: r.new_prompt,
                  diffOps,
                },
              },
            ])
          } catch (e) {
            setChatMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: 'assistant',
                content:
                  e instanceof Error
                    ? e.message
                    : 'Не удалось получить превью правки. Попробуйте ещё раз или используйте полную генерацию.',
              },
            ])
          } finally {
            setLoading(false)
          }
        })()
        return
      }

      void (async () => {
        const { plan, suggestedActions: agentBar } = await resolveStudioFollowUpPlan(text, {
          sessionId: sidRef,
          promptType,
          currentPrompt: snapshot.prompt_block,
          chatMessages: [...chatMessages, { role: 'user', content: text }],
        })
        if (agentBar?.length) {
          setSuggestedActions(agentBar)
          setSuggestionsBarExpanded(false)
        }
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
            const title = plan.titleHint?.trim() || pickPromptTitle(snapshot, taskRef)
            if (promptType === 'skill') {
              appendLocalSkill({
                title,
                body: snapshot.prompt_block,
                description: taskRef.slice(0, 500),
                tags: mergeStudioSkillTags(plan.tags.join(',')),
                frameworks: [],
              })
              window.dispatchEvent(new CustomEvent('metaprompt-nav-refresh'))
              setQuickSaved(true)
              const tagStr = plan.tags.length ? ` Теги: ${plan.tags.join(', ')}.` : ''
              pushAssistant(
                `Сохранено в **локальные скиллы** как «${title}».${tagStr} Библиотека → Скиллы.`,
              )
            } else {
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
            }
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
      void (async () => {
        setLoading(true)
        setError(null)
        setAgentThinkingLine(PRE_PROMPT_ROUTING_LINE)
        const chatHist = buildAgentChatHistory([...chatMessages, { role: 'user', content: text }])
        try {
          const ac = new AbortController()
          const tid = window.setTimeout(() => ac.abort(), AGENT_PROCESS_PRE_TIMEOUT_MS)
          try {
            const res = await api.agentProcess(
              {
                text,
                has_prompt: false,
                prompt_type: promptType,
                chat_history: chatHist,
              },
              { signal: ac.signal },
            )
            if (res.action === 'chat') {
              setAgentThinkingLine(null)
              const msg =
                String((res.data as { message?: string }).message || '').trim() || pickConversationalReply()
              setChatMessages((m) => [...m, { id: crypto.randomUUID(), role: 'assistant', content: msg }])
              setLoading(false)
              return
            }
            if (res.action === 'generate' || res.action === 'generate_skill') {
              setAgentThinkingLine(res.action === 'generate_skill' ? PRE_PROMPT_SKILL_LINE : PRE_PROMPT_TASK_LINE)
              setBaseTaskRef(text)
              setTaskInput(text)
              await handleGenerate(undefined, { taskInputOverride: text, fromPrePromptRouter: true })
              return
            }
            setAgentThinkingLine(PRE_PROMPT_TASK_LINE)
            setBaseTaskRef(text)
            setTaskInput(text)
            await handleGenerate(undefined, { taskInputOverride: text, fromPrePromptRouter: true })
          } finally {
            window.clearTimeout(tid)
          }
        } catch {
          setAgentThinkingLine(PRE_PROMPT_TASK_LINE)
          setBaseTaskRef(text)
          setTaskInput(text)
          await handleGenerate(undefined, { taskInputOverride: text, fromPrePromptRouter: true })
        }
      })()
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

  useEffect(() => {
    const t = window.setTimeout(() => {
      persistCurrentModeToRef()
      saveAgentDraftV2({
        activePromptType: promptType,
        modes: {
          text: cloneAgentStudioSnapshot(studioModesRef.current.text),
          image: cloneAgentStudioSnapshot(studioModesRef.current.image),
          skill: cloneAgentStudioSnapshot(studioModesRef.current.skill),
        },
      })
    }, 450)
    return () => window.clearTimeout(t)
  }, [
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
    skillTargetEnv,
    skillBody,
    expertLevel,
    suggestedActions,
  ])

  const handleSaveToLibrary = async () => {
    if (!result?.prompt_block) return
    const fb = (baseTaskRef || taskInput).trim()
    const title = saveTitle.trim() || pickPromptTitle(result, fb)
    if (promptType === 'skill') {
      appendLocalSkill({
        title,
        body: result.prompt_block,
        description: saveNotes.trim() || fb.slice(0, 500),
        tags: mergeStudioSkillTags(saveTags),
        frameworks: [],
      })
      window.dispatchEvent(new CustomEvent('metaprompt-nav-refresh'))
      setShowSaveDialog(false)
      setSaveNotes('')
      setSaveTags('')
      setQuickSaved(true)
      return
    }
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
    const fb = (baseTaskRef || taskInput).trim()
    const title = pickPromptTitle(result, fb)
    if (promptType === 'skill') {
      appendLocalSkill({
        title,
        body: result.prompt_block,
        description: fb.slice(0, 500),
        tags: mergeStudioSkillTags(saveTags),
        frameworks: [],
      })
      window.dispatchEvent(new CustomEvent('metaprompt-nav-refresh'))
      setQuickSaved(true)
      return
    }
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
  const tokenEstimate = Number(result?.metrics?.token_estimate ?? 0)
  const taskRefForTitles = (baseTaskRef || taskInput).trim()

  const communityPublishInitial: PublishToCommunityInitial = useMemo(
    () => ({
      title: result ? pickPromptTitle(result, taskRefForTitles) : suggestLibraryTitle(taskInput),
      prompt: result?.prompt_block || '',
      description: '',
      prompt_type: promptType === 'image' ? 'image' : promptType === 'skill' ? 'skill' : 'text',
      tags: [],
    }),
    [taskInput, taskRefForTitles, result, result?.prompt_block, promptType],
  )

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

  const expertLevelSelectOptions = useMemo(
    () =>
      (['junior', 'mid', 'senior', 'creative'] as const).map((el) => ({
        value: el,
        label: EXPERT_LEVEL_LABELS[el],
        title: `${EXPERT_LEVEL_HINTS[el]} · ${getLevelBundleForExpertLevel(el).estimatedCostHint}`,
      })),
    [],
  )

  const activeLevelBundle = useMemo(() => getLevelBundleForExpertLevel(expertLevel), [expertLevel])

  const skillTargetEnvSelectOptions = useMemo(
    () => SKILL_TARGET_ENV_OPTIONS.map((o) => ({ value: o.value, label: o.label, title: o.title })),
    [],
  )

  const latestVersionInChat = useMemo(() => {
    let m = 0
    for (const msg of chatMessages) {
      const v = msg.promptDoneCard?.version
      if (typeof v === 'number' && v > m) m = v
    }
    return m
  }, [chatMessages])

  useEffect(() => {
    if (loading && result?.has_questions && !result?.has_prompt) {
      setQuestionFollowupOpen(false)
    }
  }, [loading, result?.has_questions, result?.has_prompt])

  useEffect(() => {
    if (!result?.has_questions || result?.has_prompt) {
      setQuestionFollowupOpen(true)
    }
  }, [result?.has_questions, result?.has_prompt])

  const agentChatPlaceholder = useMemo(() => {
    if (promptType === 'image') {
      return 'Сначала опишите сцену или идею. Стили и уточнения — строкой выше, когда понадобятся.'
    }
    if (promptType === 'skill') {
      return 'Опишите, какой навык или инструкцию оформить для ИИ-ассистента (роль, шаги, формат ответа)…'
    }
    return 'Опишите задачу или попросите изменить промпт…'
  }, [promptType])

  const questionGenOpts: GenerateOptions | undefined = (baseTaskRef || taskInput).trim()
    ? { taskInputOverride: (baseTaskRef || taskInput).trim() }
    : undefined

  const renderQuestionsPanel = () => {
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
        className={`${styles.questionBox} ${styles.questionBoxCompact} ${styles.questionCarousel} ${styles.wizardAgentMerged}`}
      >
        <div className={`${styles.wizardProgressWrap} ${styles.wizardProgressWrapTight}`}>
          <div className={styles.wizardProgressBar}>
            <div className={styles.wizardProgressFill} style={{ width: `${((idx + 1) / total) * 100}%` }} />
          </div>
          <span className={styles.questionCarouselMeta}>
            {idx + 1} / {total}
          </span>
        </div>
        <div className={styles.wizardQuestionBlockAgent}>
        <div className={`${styles.questionItem} ${styles.questionItemCompact}`}>
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
        <div className={`${styles.wizardFooter} ${styles.wizardFooterCompact}`}>
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
        </div>
      </div>
    )
  }

  const resultSection = (
        <section
          className={`${styles.panel} ${styles.resultColumn} ${styles.bareColumn} ${styles.agentStackSection} ${promptType === 'skill' ? styles.resultColumnSkill : ''}`}
        >
          <div className={styles.resultColumnHeader}>
            <h2 className="pageTitleGradient">{promptType === 'skill' ? 'Скилл' : 'Результат'}</h2>
            {promptType === 'skill' ? (
              <p className={styles.resultColumnSub}>Текст ниже — тело скилла для ИИ-ассистента (не чат-ответ).</p>
            ) : null}
          </div>
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
              <p className={styles.resultPlaceholderTitle}>
                {promptType === 'skill' ? 'Текст скилла появится здесь' : 'Промпт появится здесь'}
              </p>
              <p className={styles.resultPlaceholderHint}>
                {promptType === 'skill'
                  ? 'После генерации сохраните во вкладку «Скиллы» в библиотеке — запись пойдёт туда, а не в список промптов.'
                  : 'Промпт появится здесь после диалога слева.'}
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
                  {result.scene_analysis_applied ? (
                    <span className={styles.evalMeta} title="К промпту подмешан структурированный бриф сцены (глубокий режим)">
                      Deep · сцена
                    </span>
                  ) : null}
                </div>
                <div className={styles.promptToolbar}>
                  <CopyIconButton
                    text={result.prompt_block}
                    title={promptType === 'skill' ? 'Копировать тело скилла' : 'Копировать промпт'}
                  />
                  <TryInGeminiButton prompt={result.prompt_block} />
                  {(promptType === 'text' || promptType === 'image') && (
                    <button
                      type="button"
                      className={styles.quickSaveBtn}
                      title="Проверить промпт: один раунд с выбранной моделью (POST /playground/run)"
                      disabled={loading}
                      onClick={() => {
                        setPromptPlaygroundLog([])
                        setPromptPlaygroundInput('')
                        setPromptPlaygroundOpen(true)
                      }}
                    >
                      Песочница
                    </button>
                  )}
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
                  {!quickSaved && (
                    <button
                      type="button"
                      className={styles.quickSaveBtn}
                      title={promptType === 'skill' ? 'Сохранить в библиотеку скиллов (локально)' : 'Сохранить в библиотеку'}
                      onClick={handleQuickSave}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                    </button>
                  )}
                  {quickSaved && (
                    <span
                      className={styles.quickSavedMark}
                      title={promptType === 'skill' ? 'Сохранено в библиотеку скиллов' : 'Сохранено в библиотеку'}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                    </span>
                  )}
                </div>
              </div>
              <div className={styles.resultMarkdownWrap}>
                <MarkdownOutput>{result.prompt_block}</MarkdownOutput>
              </div>
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
                        setChatInput(`Учти и примени советы по очереди:\n${body}`)
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
                            setChatInput(`Примени совет: ${tip}`)
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
                  {promptType === 'skill'
                    ? 'Оценка полноты для скилла смотрит на структуру инструкции (роль, шаги, формат). Это не оценка «умения» будущего ассистента.'
                    : result.metrics?.prompt_analysis_mode === 'image'
                      ? 'Оценка полноты для изображений: субъект, стиль, композиция, свет/палитра, негатив, техника (эвристика на сервере). Это не оценка художественного качества картинки.'
                      : 'Оценка полноты смотрит на структуру промпта (эвристика на устройстве/сервере), а не на ответ модели в чате. Перед важным использованием проверьте текст в своей модели.'}
                </p>
              )}
              <div className={styles.actions}>
                <button type="button" className="btn-secondary" onClick={() => navigate('/compare', { state: { taskInput: result.task_input || taskInput } })}>Сравнить</button>
                <button
                  type="button"
                  className={`${styles.libraryBtn} btn-secondary`}
                  onClick={() => {
                    setShowSaveDialog((prev) => {
                      if (!prev) setSaveTitle(pickPromptTitle(result, taskRefForTitles))
                      return !prev
                    })
                  }}
                >
                  {promptType === 'skill' ? 'В библиотеку скиллов' : 'В библиотеку'}
                </button>
              </div>
              {showSaveDialog && (
                <div className={styles.saveBox}>
                  <h3>{promptType === 'skill' ? 'Сохранить скилл' : 'Сохранить в библиотеку'}</h3>
                  {promptType === 'skill' ? (
                    <p className={styles.saveSkillHint}>
                      Запись попадёт в <strong>Библиотека → Скиллы</strong> (локально в браузере), не в список промптов на сервере.
                    </p>
                  ) : null}
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
                    Показывается в списке карточек. Если оставить пустым — подставим название из генерации или короткий заголовок по задаче.
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
        </section>
  )

  return (
    <div className={`${styles.home} ${styles.homeFlexFill}`}>
      <FirstVisitHomeTip />
      <div ref={agentSplitRootRef} className={`${styles.splitRoot} ${styles.splitRootFill}`}>
          <div
            className={`${styles.splitPane} ${styles.splitPaneAgentChat}`}
            style={{ flex: `${agentSplit} 1 0%`, minWidth: 0 }}
          >
            <div className={styles.agentChatColumn}>
              <div className={styles.agentChatHeader}>
                <div className={styles.agentChatHeaderTop}>
                  <div className={styles.agentHeaderLeft}>
                    <div className={styles.agentTaskTitleRow}>
                      <h2 className="pageTitleGradient">Задача</h2>
                      <div className={styles.promptTypeTabs}>
                        {(['text', 'image', 'skill'] as const).map((pt) => (
                          <button
                            key={pt}
                            type="button"
                            className={`${styles.promptTypeTab} ${promptType === pt ? styles.promptTypeTabActive : ''}`}
                            disabled={loading}
                            onClick={() => handlePromptTypeChange(pt)}
                          >
                            {pt === 'text' ? '📝 Текст' : pt === 'image' ? '📷 Фото' : '⚡ Скилл'}
                          </button>
                        ))}
                      </div>
                      <SelectDropdown
                        value={expertLevel}
                        options={expertLevelSelectOptions}
                        onChange={(v) => handleExpertLevelChange(v as ExpertLevel)}
                        aria-label="Уровень студии"
                        variant="toolbar"
                        className={styles.expertLevelSelectWrap}
                        disabled={loading}
                        footerLink={{ to: '/help', label: 'Справка: уровни' }}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.agentNewChatBtn}
                    disabled={loading}
                    onClick={resetAgentDialog}
                  >
                    Новый диалог
                  </button>
                </div>
                {taskRefForTitles ? (
                  <div
                    className={`${styles.evalStrip} ${styles.taskTextEvalStrip}`}
                    aria-live="polite"
                  >
                    <div className={styles.evalStripLeft}>
                      {taskTextTokensLoading ? (
                        <span className={styles.evalMetaSecondary}>…</span>
                      ) : (
                        <span
                          className={styles.evalMetaSecondary}
                          title="Токены только текста задачи (то, что улучшаем). Без system, без истории чата."
                        >
                          ≈{taskTextTokens ? taskTextTokens.tokens.toLocaleString() : '—'} tok
                        </span>
                      )}
                      <span
                        className={styles.evalMeta}
                        title="Размер исходной формулировки задачи; сравните с ≈tok у готового промпта справа"
                      >
                        задача
                      </span>
                    </div>
                  </div>
                ) : null}
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
                        disabled={loading}
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
                    if (m.editPreviewCard) {
                      const ep = m.editPreviewCard
                      return (
                        <div
                          key={m.id}
                          className={`${styles.chatBubbleAssistant} ${styles.editPreviewWrap}`}
                        >
                          <div className={styles.editPreviewHead}>
                            <span className={styles.editPreviewTitle}>Превью правки</span>
                            <span className={styles.editPreviewInstr} title={ep.instruction}>
                              {ep.instruction.length > 120 ? `${ep.instruction.slice(0, 120)}…` : ep.instruction}
                            </span>
                          </div>
                          {ep.diffOps.length > 0 ? (
                            <ul className={styles.editPreviewDiff} aria-label="Построчные изменения">
                              {ep.diffOps.map((row, i) => (
                                <li
                                  key={i}
                                  className={
                                    row.kind === 'ins'
                                      ? styles.editPreviewIns
                                      : row.kind === 'del'
                                        ? styles.editPreviewDel
                                        : styles.editPreviewEq
                                  }
                                >
                                  {row.text || ' '}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <pre className={styles.editPreviewMono}>{ep.newPrompt}</pre>
                          )}
                          <div className={styles.editPreviewActions}>
                            <button
                              type="button"
                              className={styles.editPreviewApply}
                              disabled={loading}
                              onClick={() => void handleEditPreviewApply(m.id, ep.newPrompt)}
                            >
                              Применить как новую версию
                            </button>
                            <button
                              type="button"
                              className={styles.editPreviewCancel}
                              disabled={loading}
                              onClick={() => handleEditPreviewCancel(m.id)}
                            >
                              Отменить
                            </button>
                          </div>
                        </div>
                      )
                    }
                    if (m.appliedTip) {
                      return (
                        <details key={m.id} className={styles.chatBubbleTipApplied}>
                          <summary className={styles.tipAppliedSummary}>
                            <span className={styles.tipAppliedLabel}>Совет</span>
                            <span className={styles.tipAppliedSummaryText}>
                              Применён совет {m.appliedTip.index}
                            </span>
                          </summary>
                          <div className={styles.tipAppliedBody}>
                            <MarkdownOutput>{m.appliedTip.fullText}</MarkdownOutput>
                          </div>
                        </details>
                      )
                    }
                    if (m.promptDoneCard) {
                      const card = m.promptDoneCard
                      const isOldVersion =
                        latestVersionInChat > 0 && card.version < latestVersionInChat
                      return (
                        <div
                          key={m.id}
                          className={`${styles.chatBubbleAssistant} ${styles.promptDoneWrap}`}
                        >
                          <div className={styles.promptDoneStatus} role="status">
                            <span className={styles.promptDoneCheck} aria-hidden>
                              ✓
                            </span>
                            {isOldVersion ? (
                              <button
                                type="button"
                                className={styles.promptDoneVersionBtn}
                                title="Вернуться к этой версии промпта"
                                onClick={() =>
                                  setVersionRestoreConfirm({
                                    version: card.version,
                                    prompt: card.promptSnapshot,
                                  })
                                }
                              >
                                v{card.version}
                              </button>
                            ) : (
                              <span className={styles.promptDoneVersion}>v{card.version}</span>
                            )}
                            <span className={styles.promptDoneSep}>·</span>
                            <span>{card.completeness}%</span>
                            {card.tokenEstimate > 0 ? (
                              <>
                                <span className={styles.promptDoneSep}>·</span>
                                <span>≈{card.tokenEstimate.toLocaleString('ru-RU')} tok</span>
                              </>
                            ) : null}
                            <span className={styles.promptDoneSep}>·</span>
                            <span className={styles.promptDoneTech}>{card.techniquesLabel}</span>
                          </div>
                          {card.suggestions.length > 0 ? (
                            <div
                              className={styles.promptDoneSuggestionsWrap}
                              onMouseLeave={() => {
                                setHoveredPromptSuggestion((prev) =>
                                  prev?.msgId === m.id ? null : prev,
                                )
                              }}
                            >
                              <div className={styles.promptDoneActions}>
                                {card.suggestions.map((s, i) => {
                                  const tipActive =
                                    hoveredPromptSuggestion?.msgId === m.id &&
                                    hoveredPromptSuggestion.index === i
                                  return (
                                    <button
                                      key={`${m.id}-s-${i}`}
                                      type="button"
                                      className={`${styles.promptDoneChipCompact} ${
                                        tipActive ? styles.promptDoneChipCompactActive : ''
                                      }`}
                                      disabled={loading || !result?.prompt_block?.trim()}
                                      aria-describedby={
                                        tipActive ? `${m.id}-tip-preview` : undefined
                                      }
                                      onMouseEnter={() =>
                                        setHoveredPromptSuggestion({ msgId: m.id, index: i })
                                      }
                                      onClick={() => {
                                        const text = s.fullText.trim()
                                        if (!text || loading || !result?.prompt_block?.trim()) return
                                        setHoveredPromptSuggestion(null)
                                        const tipMsg: GenChatMsg = {
                                          id: crypto.randomUUID(),
                                          role: 'assistant',
                                          content: '',
                                          appliedTip: { index: i + 1, fullText: text },
                                        }
                                        void handleGenerate(undefined, {
                                          forceIteration: true,
                                          feedbackOverride: text,
                                          chatAppendBeforeResult: [tipMsg],
                                        })
                                      }}
                                    >
                                      Совет {i + 1}
                                    </button>
                                  )
                                })}
                              </div>
                              {hoveredPromptSuggestion?.msgId === m.id &&
                              card.suggestions[hoveredPromptSuggestion.index] ? (
                                <div
                                  id={`${m.id}-tip-preview`}
                                  className={styles.promptDoneTipPreview}
                                  role="note"
                                >
                                  {card.suggestions[hoveredPromptSuggestion.index].fullText}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          {card.diff?.rows.length ? (
                            <div className={styles.promptDoneDiff}>
                              <div className={styles.promptDoneDiffTitle}>
                                Что изменилось (v{card.diff.fromVersion} → v{card.diff.toVersion})
                              </div>
                              <ul className={styles.promptDoneDiffList}>
                                {card.diff.rows.map((row, i) => (
                                  <li
                                    key={i}
                                    className={
                                      row.kind === 'add'
                                        ? styles.promptDoneDiffAdd
                                        : row.kind === 'rm'
                                          ? styles.promptDoneDiffRm
                                          : styles.promptDoneDiffChg
                                    }
                                  >
                                    {row.text}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                          {promptType === 'skill' ? (
                            <div className={styles.skillDoneBar}>
                              <button
                                type="button"
                                className={styles.skillSandboxOpenBtn}
                                disabled={loading || !result?.prompt_block?.trim()}
                                onClick={() => {
                                  setSkillSandboxLog([])
                                  setSkillSandboxInput('')
                                  setSkillSandboxOpen(true)
                                }}
                              >
                                Песочница
                              </button>
                            </div>
                          ) : null}
                          {card.skillTestCases && card.skillTestCases.length > 0 ? (
                            <details className={styles.skillTestAccordion}>
                              <summary className={styles.skillTestSummary}>
                                Тест-кейсы ({card.skillTestCases.length})
                                {skillTestRunning ? (
                                  <span className={styles.skillTestRunning}> — проверка…</span>
                                ) : null}
                              </summary>
                              <div className={styles.skillTestBody}>
                                <ol className={styles.skillTestList}>
                                  {card.skillTestCases.map((tc, idx) => (
                                    <li key={idx}>
                                      <div className={styles.skillTestUser}>{tc.user}</div>
                                      <div className={styles.skillTestExpect}>
                                        Ожидается подстрока: <code>{tc.expect_substring}</code>
                                      </div>
                                      {skillTestResults[idx] ? (
                                        <span
                                          className={
                                            skillTestResults[idx] === 'pass'
                                              ? styles.skillTestPass
                                              : styles.skillTestFail
                                          }
                                        >
                                          {skillTestResults[idx] === 'pass' ? 'OK' : 'Нет вхождения'}
                                        </span>
                                      ) : null}
                                    </li>
                                  ))}
                                </ol>
                                <button
                                  type="button"
                                  className={styles.skillTestRunAll}
                                  disabled={
                                    skillTestRunning || loading || !result?.prompt_block?.trim()
                                  }
                                  onClick={() => void runSkillTestCases(card.skillTestCases!)}
                                >
                                  Запустить все
                                </button>
                              </div>
                            </details>
                          ) : null}
                        </div>
                      )
                    }
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
                        {agentThinkingLine ??
                          AGENT_THINKING_PHASES[agentThinkingIdx % AGENT_THINKING_PHASES.length]}
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
                {result?.has_prompt && suggestedActions.length > 0 && !loading && (
                  <div className={styles.suggestedActionsBar} role="region" aria-label="Подсказки">
                    <div className={styles.suggestedActionsBarInner}>
                      {(suggestionsBarExpanded ? suggestedActions : suggestedActions.slice(0, 3)).map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          className={styles.suggestedActionChip}
                          onClick={() => void handleSuggestedActionClick(a)}
                        >
                          {a.emoji ? <span className={styles.suggestedActionEmoji}>{a.emoji}</span> : null}
                          <span>{a.title}</span>
                        </button>
                      ))}
                      {suggestedActions.length > 3 ? (
                        <button
                          type="button"
                          className={styles.suggestedActionsMore}
                          onClick={() => setSuggestionsBarExpanded((v) => !v)}
                        >
                          {suggestionsBarExpanded ? 'Свернуть' : 'Ещё…'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                )}
                {result?.has_questions && !result?.has_prompt && (
                  <details
                    className={`${styles.agentWizardInComposer} ${styles.agentWizardDetails}`}
                    open={questionFollowupOpen}
                    onToggle={(e) => setQuestionFollowupOpen(e.currentTarget.open)}
                  >
                    <summary className={styles.agentWizardSummary}>
                      <span>Уточняющие вопросы</span>
                      {loading ? (
                        <span className={styles.agentWizardSummaryMeta}>Генерация…</span>
                      ) : null}
                    </summary>
                    <div className={styles.agentWizardDetailsBody}>{renderQuestionsPanel()}</div>
                  </details>
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
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      if (!loading && chatInput.trim()) handleAgentSend()
                    }
                  }}
                  placeholder={agentChatPlaceholder}
                  minHeightPx={result?.has_questions && !result?.has_prompt ? 52 : 72}
                  maxHeightPx={280}
                  spellCheck
                />
                <div className={cb.composerFooter}>
                  <div className={cb.composerFooterRow}>
                    <div className={cb.composerFooterMid}>
                      <span
                        className={styles.studioCostHint}
                        title={`Ориентир по профилю «${activeLevelBundle.label}»: фактические токены и цена зависят от модели и длины.`}
                      >
                        {activeLevelBundle.estimatedCalls} вызов(ов) · {activeLevelBundle.estimatedCostHint}
                      </span>
                      <SelectDropdown
                        value={genModel}
                        options={genModelSelectOptions}
                        onChange={setGenModel}
                        aria-label="Модель генерации"
                        variant="composer"
                        disabled={loading}
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
                          disabled={loading}
                          footerLink={{ to: '/presets', label: 'Создать пресет…' }}
                        />
                      ) : promptType === 'skill' ? (
                        <>
                          <SelectDropdown
                            value={skillPresetId}
                            options={skillPresetSelectOptions}
                            onChange={setSkillPresetId}
                            aria-label="Пресет для генерации скилла"
                            variant="composer"
                            disabled={loading}
                            footerLink={{ to: '/presets', label: 'Создать пресет…' }}
                          />
                          <SelectDropdown
                            value={skillTargetEnv}
                            options={skillTargetEnvSelectOptions}
                            onChange={setSkillTargetEnv}
                            aria-label="Среда для скилла"
                            variant="composer"
                            disabled={loading}
                          />
                          <SelectDropdown
                            value={targetModel}
                            options={targetModelSelectOptions}
                            onChange={setTargetModel}
                            aria-label="Целевая модель или среда для скилла"
                            variant="composer"
                            disabled={loading}
                            footerLink={{ to: '/models', label: 'Каталог моделей' }}
                            triggerContent={targetModel === 'unknown' ? <IconGlobe /> : undefined}
                            triggerClassName={targetModel === 'unknown' ? styles.targetTriggerIconOnly : ''}
                          />
                        </>
                      ) : (
                        <SelectDropdown
                          value={targetModel}
                          options={targetModelSelectOptions}
                          onChange={setTargetModel}
                          aria-label="Модель, для которой пишется промпт"
                          variant="composer"
                          disabled={loading}
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
                        disabled={loading}
                        onClick={() => setTechniqueMode((m) => (m === 'auto' ? 'manual' : 'auto'))}
                      >
                        {techniqueMode === 'auto' ? 'A' : '✎'}
                      </button>
                      <button
                        type="button"
                        className={cb.composerGhostBtn}
                        disabled={loading}
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
                    <div className={styles.techPickerBar}>
                      <button
                        ref={techPickerBtnRef}
                        type="button"
                        className={`${styles.techPickerTrigger} ${cb.composerGhostBtn}`}
                        aria-expanded={techPickerOpen}
                        aria-haspopup="listbox"
                        aria-label="Выбор техник для генерации"
                        disabled={loading}
                        onClick={() => !loading && setTechPickerOpen((o) => !o)}
                      >
                        Техники
                        {manualTechs.length > 0 ? (
                          <span className={styles.techPickerTriggerCount}>{manualTechs.length}</span>
                        ) : null}
                      </button>
                      <PortalDropdown
                        open={techPickerOpen}
                        onClose={() => setTechPickerOpen(false)}
                        anchorRef={techPickerBtnRef}
                        minWidth={300}
                        align="left"
                      >
                        <input
                          type="search"
                          className={styles.techMenuSearch}
                          placeholder="Поиск по названию или id…"
                          value={techMenuFilter}
                          onChange={(e) => setTechMenuFilter(e.target.value)}
                          onMouseDown={(e) => e.stopPropagation()}
                          aria-label="Фильтр списка техник"
                        />
                        {techniques
                          .filter((t) => {
                            const q = techMenuFilter.trim().toLowerCase()
                            if (!q) return true
                            return (
                              t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q)
                            )
                          })
                          .map((t) => {
                            const on = manualTechs.includes(t.id)
                            return (
                              <button
                                key={t.id}
                                type="button"
                                role="option"
                                aria-selected={on}
                                className={`${menuStyles.menuItem} ${on ? menuStyles.menuItemActive : ''}`}
                                onClick={() => {
                                  setManualTechs((prev) =>
                                    prev.includes(t.id)
                                      ? prev.filter((x) => x !== t.id)
                                      : [...prev, t.id],
                                  )
                                }}
                              >
                                <span className={styles.techMenuCheck} aria-hidden>
                                  {on ? '\u2713 ' : '\u2003'}
                                </span>
                                {t.name}
                              </button>
                            )
                          })}
                      </PortalDropdown>
                    </div>
                  </div>
                )}
                {showAdvanced && (
                  <div className={cb.composerInset}>
                    <div className={styles.advancedInline}>
                      <label className={styles.advancedInlineField}>
                        Т° {clampExpertGenerationTemperature(temperature)}
                        <input
                          type="range"
                          min={0.1}
                          max={EXPERT_GENERATION_TEMPERATURE_CAP}
                          step={0.05}
                          value={clampExpertGenerationTemperature(temperature)}
                          title="Потолок температуры для стабильного блока [PROMPT]"
                          disabled={loading}
                          onChange={(e) => setTemperature(clampExpertGenerationTemperature(parseFloat(e.target.value)))}
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
                          disabled={loading}
                          onChange={(e) => setTopP(parseFloat(e.target.value))}
                        />
                      </label>
                      <label className={styles.advancedInlineField}>
                        Top-K
                        <input
                          type="number"
                          value={topK}
                          disabled={loading}
                          onChange={(e) => setTopK(e.target.value ? Number(e.target.value) : '')}
                          className={styles.topKInput}
                        />
                      </label>
                      <label className={styles.questionsCompact}>
                        <input
                          type="checkbox"
                          checked={questionsMode}
                          disabled={loading}
                          onChange={(e) => setQuestionsMode(e.target.checked)}
                        />
                        <span>Вопросы</span>
                      </label>
                    </div>
                    <div className={styles.advancedSkillBodyBlock}>
                      <span className={styles.advancedSkillBodyTop}>
                        <span className={styles.advancedSkillBodyLabel}>Контекст скилла (опционально)</span>
                        {localSkillsForPicker.length > 0 ? (
                          <>
                            <button
                              ref={skillInsertBtnRef}
                              type="button"
                              className={styles.skillInsertFromLibBtn}
                              onClick={() => setSkillInsertOpen((o) => !o)}
                              aria-expanded={skillInsertOpen}
                              aria-haspopup="listbox"
                            >
                              Из библиотеки
                            </button>
                            <PortalDropdown
                              open={skillInsertOpen}
                              onClose={() => setSkillInsertOpen(false)}
                              anchorRef={skillInsertBtnRef}
                              minWidth={260}
                              align="right"
                            >
                              {localSkillsForPicker.map((s) => (
                                <button
                                  key={s.id}
                                  type="button"
                                  role="option"
                                  className={menuStyles.menuItem}
                                  title={s.description || s.title}
                                  onClick={() => {
                                    setSkillBody((prev) => {
                                      const next = (prev || '').trim()
                                      const block = (s.body || '').trim()
                                      if (!block) return prev
                                      if (!next) return block
                                      return `${next}\n\n---\n${s.title}\n\n${block}`
                                    })
                                    setSkillInsertOpen(false)
                                  }}
                                >
                                  {s.title}
                                </button>
                              ))}
                            </PortalDropdown>
                          </>
                        ) : null}
                      </span>
                      <span className={styles.advancedSkillBodyHint}>
                        Уходит в запрос как skill_body — контекст для генерации промпта.
                      </span>
                      <AutoTextarea
                        className={styles.advancedSkillBodyTextarea}
                        value={skillBody}
                        onChange={(e) => setSkillBody(e.target.value)}
                        placeholder="Текст скилла или инструкции…"
                        minHeightPx={44}
                        maxHeightPx={140}
                        spellCheck
                      />
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
      {versionRestoreConfirm ? (
        <div
          className={styles.versionRestoreBackdrop}
          role="dialog"
          aria-modal="true"
          aria-labelledby="version-restore-title"
        >
          <div className={styles.versionRestoreBox}>
            <h3 id="version-restore-title" className={styles.versionRestoreTitle}>
              Перейти к версии v{versionRestoreConfirm.version}?
            </h3>
            <p className={styles.versionRestoreText}>
              Текст промпта справа заменится на сохранённую версию из чата. Продолжить?
            </p>
            <div className={styles.versionRestoreActions}>
              <button
                type="button"
                className={`${styles.primaryAction} btn-primary`}
                onClick={() => {
                  const snap = versionRestoreConfirm.prompt
                  setResult((prev) => (prev ? { ...prev, prompt_block: snap } : prev))
                  setVersionRestoreConfirm(null)
                }}
              >
                Да, перейти
              </button>
              <button type="button" className="btn-ghost" onClick={() => setVersionRestoreConfirm(null)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {promptPlaygroundOpen
        ? createPortal(
            <div
              className={styles.skillSandboxBackdrop}
              role="dialog"
              aria-modal="true"
              aria-label="Песочница промпта"
              onClick={() => !promptPlaygroundBusy && setPromptPlaygroundOpen(false)}
            >
              <div className={styles.skillSandboxModal} onClick={(e) => e.stopPropagation()}>
                <div className={styles.skillSandboxHead}>
                  <h3 className={styles.skillSandboxTitle}>Песочница промпта</h3>
                  <button
                    type="button"
                    className={styles.skillSandboxClose}
                    disabled={promptPlaygroundBusy}
                    onClick={() => setPromptPlaygroundOpen(false)}
                  >
                    ×
                  </button>
                </div>
                <p className={styles.skillSandboxHint}>
                  Системный контекст = текущий промпт справа. Введите тестовый запрос пользователя — ответ модели
                  появится ниже. Используется модель генерации из композера.
                </p>
                <div className={styles.skillSandboxLog}>
                  {promptPlaygroundLog.length === 0 ? (
                    <p className={styles.skillSandboxEmpty}>Напишите тестовый ввод ниже.</p>
                  ) : (
                    promptPlaygroundLog.map((row, i) => (
                      <div
                        key={i}
                        className={
                          row.role === 'user' ? styles.skillSandboxRowUser : styles.skillSandboxRowAsst
                        }
                      >
                        <MarkdownOutput>{row.content}</MarkdownOutput>
                      </div>
                    ))
                  )}
                </div>
                <div className={styles.skillSandboxComposer}>
                  <AutoTextarea
                    className={styles.skillSandboxTextarea}
                    value={promptPlaygroundInput}
                    onChange={(e) => setPromptPlaygroundInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        if (!promptPlaygroundBusy && promptPlaygroundInput.trim()) void sendPromptPlaygroundMessage()
                      }
                    }}
                    minHeightPx={44}
                    maxHeightPx={120}
                    placeholder="Тестовый ввод (как от пользователя)…"
                  />
                  <button
                    type="button"
                    className={styles.skillSandboxSend}
                    disabled={promptPlaygroundBusy || !promptPlaygroundInput.trim() || !result?.prompt_block?.trim()}
                    onClick={() => void sendPromptPlaygroundMessage()}
                  >
                    {promptPlaygroundBusy ? '…' : 'Отправить'}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      {skillSandboxOpen
        ? createPortal(
            <div
              className={styles.skillSandboxBackdrop}
              role="dialog"
              aria-modal="true"
              aria-label="Песочница скилла"
              onClick={() => !skillSandboxBusy && setSkillSandboxOpen(false)}
            >
              <div className={styles.skillSandboxModal} onClick={(e) => e.stopPropagation()}>
                <div className={styles.skillSandboxHead}>
                  <h3 className={styles.skillSandboxTitle}>Песочница скилла</h3>
                  <button
                    type="button"
                    className={styles.skillSandboxClose}
                    disabled={skillSandboxBusy}
                    onClick={() => setSkillSandboxOpen(false)}
                  >
                    ×
                  </button>
                </div>
                <p className={styles.skillSandboxHint}>
                  Один раунд: системный контекст = текущий промпт-скилл справа. Сообщения не сохраняются на
                  сервере.
                </p>
                <div className={styles.skillSandboxLog}>
                  {skillSandboxLog.length === 0 ? (
                    <p className={styles.skillSandboxEmpty}>Напишите сообщение ниже.</p>
                  ) : (
                    skillSandboxLog.map((row, i) => (
                      <div
                        key={i}
                        className={
                          row.role === 'user' ? styles.skillSandboxRowUser : styles.skillSandboxRowAsst
                        }
                      >
                        <MarkdownOutput>{row.content}</MarkdownOutput>
                      </div>
                    ))
                  )}
                </div>
                <div className={styles.skillSandboxComposer}>
                  <AutoTextarea
                    className={styles.skillSandboxTextarea}
                    value={skillSandboxInput}
                    onChange={(e) => setSkillSandboxInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        if (!skillSandboxBusy && skillSandboxInput.trim()) void sendSkillSandboxMessage()
                      }
                    }}
                    minHeightPx={44}
                    maxHeightPx={120}
                    placeholder="Сообщение для модели…"
                  />
                  <button
                    type="button"
                    className={styles.skillSandboxSend}
                    disabled={skillSandboxBusy || !skillSandboxInput.trim()}
                    onClick={() => void sendSkillSandboxMessage()}
                  >
                    {skillSandboxBusy ? '…' : 'Отправить'}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
