import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  api,
  normalizeSuggestedStudioActions,
  type GenerateRequest,
  type GenerateResult,
  type ImageMetaResponse,
  type LibraryItem,
  type OpenRouterModel,
  type SuggestedStudioAction,
  type UserPresetRecord,
  type Workspace,
} from '../api/client'
import {
  nextLlmStreamChunkSize,
  nextLlmStreamDelayMs,
  useSimulatedLlmStream,
} from '../lib/simulatedLlmStream'
import { loadTier, type TierValue } from '../components/TierSelector'
import FirstVisitHomeTip from '../components/FirstVisitHomeTip'
import HomeOnboardingHints from '../components/HomeOnboardingHints'
import { getRecentSessions, pushRecentSession } from '../lib/recentSessions'
import { isModEnter } from '../lib/hotkeys'
import HotkeysCheatsheet from '../components/HotkeysCheatsheet'
import { suggestLibraryTitle } from '../lib/libraryTitle'
import { clearAgentDraftV2, loadAgentDraftV2, saveAgentDraftV2 } from '../lib/agentDraft'
import {
  cloneAgentStudioSnapshot,
  createEmptyStudioSnapshot,
  defaultWelcomeForMode,
  type AgentStudioSnapshot,
  type ExpertLevel,
  type PromptStudioMode,
} from '../lib/agentStudioModes'
import {
  clampExpertGenerationTemperature,
  EXPERT_DEFAULT_GEN_MODEL,
  expertLevelUsesManualTechniqueHint,
  getExpertLevelPreset,
} from '../lib/expertLevelPresets'
import { useT } from '../i18n'
import { getLevelBundleForExpertLevel } from '../lib/levelBundle'
import { filterManualTechsForReasoningModel, isReasoningModelId } from '../lib/modelReasoning'
import { shortGenerationModelLabel } from '../utils/generationModelLabel'
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
import { computeRefinedLineDiffOps } from '../lib/lineDiffLcs'
import { buildAgentChatHistory, resolveStudioFollowUpPlan } from '../lib/agentStudioProcessPlan'
import { IMAGE_STYLES_ALL } from '../lib/imageStyles'
import { loadImageStyleFavoriteIds, saveImageStyleFavoriteIds } from '../lib/imageStyleFavorites'
import { appendRecentTechniqueIds, loadRecentTechniqueIds } from '../lib/recentTechniques'
import { appendLocalSkill, loadLocalSkills } from '../lib/localSkillsStore'
import { isIdePromptStreamSeen, markIdePromptStreamSeen } from '../lib/idePromptStreamStorage'
import type { PromptDoneCard } from '../lib/studioPromptDoneCard'
import {
  ACTIVE_SESSION_KEY,
  ACTIVE_WORKSPACE_KEY,
  AGENT_PROCESS_PRE_TIMEOUT_MS,
  AGENT_THINKING_PHASES,
  HOME_AGENT_SPLIT_KEY,
  PRE_PROMPT_ROUTING_LINE,
  PRE_PROMPT_SKILL_LINE,
  PRE_PROMPT_TASK_LINE,
  clampSplit,
  loadAgentSplit,
} from '../features/studio/studioHomeConstants'
import {
  buildDoneGenerationContext,
  computeChatAfterGeneration,
  mergeSessionVersionIntoResult,
  mergeStudioSkillTags,
  normalizeClientGenerateResult,
  pickPromptTitle,
  type StudioChatMessage,
  type StudioGenChatMsg,
  type StudioTechnique,
} from '../features/studio/homeHelpers'
import { StudioResultPanel } from '../features/studio/StudioResultPanel'
import { StudioAgentChatHeader } from '../features/studio/StudioAgentChatHeader'
import { StudioAgentChatMessageList } from '../features/studio/StudioAgentChatMessageList'
import { StudioAgentComposer } from '../features/studio/StudioAgentComposer'
import { StudioLlmReviewDock } from '../features/studio/StudioLlmReviewDock'
import { StudioModals } from '../features/studio/StudioModals'
import { StudioQuestionsWizard } from '../features/studio/StudioQuestionsWizard'
import type { StudioGenerateOptions } from '../features/studio/studioUiTypes'
import styles from './Home.module.css'

export default function Home() {
  const { t } = useT()
  const location = useLocation()
  const navigate = useNavigate()
  const [taskInput, setTaskInput] = useState('')
  const [feedback, setFeedback] = useState('')
  const [loading, setLoading] = useState(false)
  const [hotkeysOpen, setHotkeysOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GenerateResult | null>(null)
  const [iterationMode, setIterationMode] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(localStorage.getItem(ACTIVE_SESSION_KEY))

  const [modelLabels, setModelLabels] = useState<Record<string, string>>({ unknown: 'Неизвестно / Любая модель' })
  const [generationOptions, setGenerationOptions] = useState<string[]>([])
  const [techniques, setTechniques] = useState<StudioTechnique[]>([])
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
  const [saveLibraryTarget, setSaveLibraryTarget] = useState<'new' | 'existing'>('new')
  const [saveExistingLibraryId, setSaveExistingLibraryId] = useState<number | ''>('')
  const [saveVersionAction, setSaveVersionAction] = useState<'append' | 'replace_latest'>('append')
  const [librarySaveOptions, setLibrarySaveOptions] = useState<LibraryItem[]>([])
  const [questionState, setQuestionState] = useState<Record<number, { options: string[]; custom: string }>>({})
  const [llmReviewOpen, setLlmReviewOpen] = useState(false)
  const [llmReviewText, setLlmReviewText] = useState('')
  const [llmReviewBusy, setLlmReviewBusy] = useState(false)
  const [llmReviewModel, setLlmReviewModel] = useState('')
  const [llmReviewFromCache, setLlmReviewFromCache] = useState(false)
  const [llmReviewHints, setLlmReviewHints] = useState<string[]>([])
  const [llmReviewHintsOpen, setLlmReviewHintsOpen] = useState(false)
  const [llmReviewMaximized, setLlmReviewMaximized] = useState(false)
  const [imageTryBusy, setImageTryBusy] = useState(false)
  const [imageTryCoverPath, setImageTryCoverPath] = useState<string | null>(null)
  const [imageTryDataUrl, setImageTryDataUrl] = useState<string | null>(null)
  const [modelsData, setModelsData] = useState<OpenRouterModel[]>([])
  const [preferredTargetModels, setPreferredTargetModels] = useState<string[]>(['unknown'])
  const [targetModel, setTargetModel] = useState('unknown')
  const [agentSplit, setAgentSplit] = useState(() => loadAgentSplit())
  const [chatMessages, setStudioChatMessages] = useState<StudioChatMessage[]>([])
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
  /** Если false — при смене уровня подставляется EXPERT_DEFAULT_GEN_MODEL. */
  const [useCustomGenModel, setUseCustomGenModel] = useState(false)
  const [tier, setTier] = useState<TierValue>(() => loadTier())
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
  /** Раскрытый полный diff у карточки «промпт готов» (итерация). */
  const [promptDoneFullDiffMsgId, setPromptDoneFullDiffMsgId] = useState<string | null>(null)
  /** Снимки студии по вкладкам «Текст / Фото / Скилл» — при переключении не смешиваем чаты и сессии. */
  const studioModesRef = useRef<Record<PromptStudioMode, AgentStudioSnapshot>>({
    text: cloneAgentStudioSnapshot(createEmptyStudioSnapshot('text')),
    image: cloneAgentStudioSnapshot(createEmptyStudioSnapshot('image')),
    skill: cloneAgentStudioSnapshot(createEmptyStudioSnapshot('skill')),
  })

  const idePromptBlock = result?.prompt_block ?? ''
  const ideSessionKey = sessionId?.trim() ?? ''
  const ideStreamSeen =
    Boolean(ideSessionKey && idePromptBlock.trim()) && isIdePromptStreamSeen(ideSessionKey, idePromptBlock)
  const markIdeStreamComplete = useCallback(() => {
    if (!ideSessionKey || !idePromptBlock.trim()) return
    markIdePromptStreamSeen(ideSessionKey, idePromptBlock)
  }, [ideSessionKey, idePromptBlock])
  const streamedPromptIde = useSimulatedLlmStream(idePromptBlock, {
    suspend: loading || ideStreamSeen,
    onStreamComplete: markIdeStreamComplete,
  })
  const streamedLlmReviewBody = useSimulatedLlmStream(llmReviewText, {
    suspend: llmReviewBusy || llmReviewFromCache,
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
    setStudioChatMessages(fresh.chatMessages as StudioChatMessage[])
    setTaskInput(fresh.taskInput)
    setBaseTaskRef(fresh.baseTaskRef)
    setFeedback(fresh.feedback)
    setResult(fresh.result)
    setSessionId(fresh.sessionId)
    const hid = fresh.sessionId?.trim()
    const pbt = typeof fresh.result?.prompt_block === 'string' ? fresh.result.prompt_block : ''
    if (hid && pbt.trim()) {
      markIdePromptStreamSeen(hid, pbt)
    }
    setIterationMode(fresh.iterationMode)
    setQuestionState(fresh.questionState)
    setQuestionCarouselIdx(fresh.questionCarouselIdx)
    setQuickSaved(fresh.quickSaved)
    const lvl = fresh.expertLevel ?? 'mid'
    setExpertLevel(lvl)
    const modeForPreset = targetMode ?? promptTypeRef.current
    applyExpertPreset(lvl, modeForPreset)
    const presetAfter = getExpertLevelPreset(lvl, modeForPreset)
    const hintProf = expertLevelUsesManualTechniqueHint(lvl, modeForPreset)
    setManualTechPickerCollapsed(hintProf && presetAfter.techniqueMode === 'manual')
    setManualTechHintDismissed(true)
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

  useEffect(() => {
    if (!showSaveDialog) {
      setSaveLibraryTarget('new')
      setSaveExistingLibraryId('')
      setSaveVersionAction('append')
      return
    }
    if (promptType === 'skill') return
    let cancelled = false
    setSaveLibraryTarget('new')
    setSaveExistingLibraryId('')
    setSaveVersionAction('append')
    api
      .getLibrary({})
      .then((r) => {
        if (!cancelled) setLibrarySaveOptions(r.items)
      })
      .catch(() => {
        if (!cancelled) setLibrarySaveOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [showSaveDialog, promptType])

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
      const p = getExpertLevelPreset(level, promptType)
      const hintProf = expertLevelUsesManualTechniqueHint(level, promptType)
      setManualTechPickerCollapsed(hintProf && p.techniqueMode === 'manual')
      setManualTechHintDismissed(!hintProf)
      if (!useCustomGenModel) {
        setGenModel(EXPERT_DEFAULT_GEN_MODEL[level])
      }
      studioModesRef.current[promptType] = cloneAgentStudioSnapshot({
        ...studioModesRef.current[promptType],
        expertLevel: level,
      })
    },
    [promptType, applyExpertPreset, loading, useCustomGenModel],
  )

  const agentSplitRootRef = useRef<HTMLDivElement>(null)
  const agentChatScrollRef = useRef<HTMLDivElement>(null)
  const imageStyleMoreBtnRef = useRef<HTMLButtonElement>(null)
  const [issueBannerDismissed, setIssueBannerDismissed] = useState(false)
  const lastQuestionAnswersRef = useRef<{ question: string; answers: string[] }[] | undefined>(undefined)
  const lastClarificationsMsgIdRef = useRef<string | null>(null)
  /** После «Креативнее» / «Продумать»: базовый промпт и текст улучшения для второго запроса с ответами мастера. */
  const improvementWizardApplyRef = useRef<{ basePrompt: string; feedback: string } | null>(null)
  const agentStudioBootstrappedRef = useRef(false)
  const restoredFromSidebarRef = useRef(false)
  const [agentThinkingIdx, setAgentThinkingIdx] = useState(0)
  /** Фиксированная строка «думает» (роутинг / этап); если null — ротация AGENT_THINKING_PHASES */
  const [agentThinkingLine, setAgentThinkingLine] = useState<string | null>(null)
  /** Псевдо-стриминг текста в плашке «думает» */
  const [thinkingStreamText, setThinkingStreamText] = useState('')
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
  const [promptPlaygroundThinkingLine, setPromptPlaygroundThinkingLine] = useState('')
  const [skillSandboxThinkingLine, setSkillSandboxThinkingLine] = useState('')
  const [llmReviewThinkingLine, setLlmReviewThinkingLine] = useState('')
  /** У Senior / Creative (ручные техники) панель по умолчанию свёрнута — лёгкая подсказка у кнопки A/✎. */
  const [manualTechPickerCollapsed, setManualTechPickerCollapsed] = useState(false)
  /** Скрывается по hover до следующей смены уровня (Senior/Creative). */
  const [manualTechHintDismissed, setManualTechHintDismissed] = useState(true)
  /** После сохранения в библиотеку — подсказка у «Опубликовать в сообществе»; hover скрывает до следующего сохранения. */
  const [publishCommunityHintVisible, setPublishCommunityHintVisible] = useState(false)
  const prevGenModelForReasoningRef = useRef<string>('')
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

  useEffect(() => {
    if (techniqueMode !== 'manual') setTechMenuFilter('')
  }, [techniqueMode])

  const localSkillsForPicker = useMemo(() => loadLocalSkills(), [localSkillsTick])


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
    setImageTryCoverPath(null)
    setImageTryDataUrl(null)
  }, [result?.prompt_block])

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
      const restored = stored as StudioChatMessage[]
      setStudioChatMessages(restored)
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
      const w: StudioChatMessage[] = [{ id: 'welcome', role: 'assistant', content: defaultWelcomeForMode('text') }]
      setStudioChatMessages(w)
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
    setStudioChatMessages((msgs) => {
      if (msgs.length > 0) return msgs
      const w: StudioChatMessage[] = [{ id: 'welcome', role: 'assistant', content: defaultWelcomeForMode('text') }]
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
      const prefillMsgs: StudioChatMessage[] = [
        { id: 'welcome', role: 'assistant', content: defaultWelcomeForMode('text') },
        { id: crypto.randomUUID(), role: 'user', content: t },
      ]
      setStudioChatMessages(prefillMsgs)
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
    const welcomeSkill: StudioChatMessage[] = [
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
            setResult((prev) => {
              const merged = mergeSessionVersionIntoResult(
                prev?.session_id === sessionId ? prev : null,
                latest,
                sessionId,
              )
              const fp = merged.prompt_block?.trim() ?? ''
              if (sessionId?.trim() && fp) {
                const reusePrev = Boolean(prev && prev.session_id === sessionId && prev.has_prompt)
                if (!reusePrev) {
                  markIdePromptStreamSeen(sessionId, fp)
                }
              }
              return merged
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
    let cancelled = false
    const timerIds: number[] = []
    const scheduleNext = () => {
      const t = window.setTimeout(() => {
        if (cancelled) return
        setAgentThinkingIdx((i) => (i + 1) % AGENT_THINKING_PHASES.length)
        scheduleNext()
      }, 6400 + Math.floor(Math.random() * 9000))
      timerIds.push(t)
    }
    timerIds.push(window.setTimeout(scheduleNext, 4200 + Math.floor(Math.random() * 7000)))
    return () => {
      cancelled = true
      timerIds.forEach((tid) => window.clearTimeout(tid))
    }
  }, [loading, agentThinkingLine])

  useEffect(() => {
    if (!loading) {
      setThinkingStreamText('')
      return
    }
    const full =
      agentThinkingLine ?? AGENT_THINKING_PHASES[agentThinkingIdx % AGENT_THINKING_PHASES.length]
    let pos = 0
    setThinkingStreamText('')
    let cancelled = false
    const twIds: number[] = []
    const tick = () => {
      if (cancelled) return
      if (pos >= full.length) {
        setThinkingStreamText(full)
        return
      }
      const chunk = nextLlmStreamChunkSize()
      pos = Math.min(full.length, pos + chunk)
      setThinkingStreamText(full.slice(0, pos))
      twIds.push(window.setTimeout(tick, nextLlmStreamDelayMs()))
    }
    twIds.push(window.setTimeout(tick, nextLlmStreamDelayMs()))
    return () => {
      cancelled = true
      twIds.forEach((tid) => window.clearTimeout(tid))
    }
  }, [loading, agentThinkingLine, agentThinkingIdx])

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
    /** Фаза 1 двухшагового улучшения: только вопросы на сервере. */
    improvementPrep?: 'creative' | 'deep_improve'
    skipAgentChatReplies?: boolean
    /** Сообщения, добавляемые в чат до блоков «размышления» / карточки результата (например «применён совет»). */
    chatAppendBeforeResult?: StudioGenChatMsg[]
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
    if (!opts?.improvementPrep && !(questionAnswers && questionAnswers.length > 0)) {
      improvementWizardApplyRef.current = null
    }
    lastQuestionAnswersRef.current = questionAnswers
    setIssueBannerDismissed(false)
    setSuggestedActions([])
    setSuggestionsBarExpanded(false)
    setLoading(true)
    setError(null)
    const improvementPrep = opts?.improvementPrep
    const isIteration =
      opts?.forceIteration !== undefined ? opts.forceIteration : iterationMode
    const feedbackText = isIteration ? (opts?.feedbackOverride ?? feedback).trim() : ''
    const previousPrompt =
      isIteration || improvementPrep
        ? opts?.previousPromptOverride ?? result?.prompt_block
        : undefined
    let modelWaitTimer: number | undefined
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
        tier,
        improvement_prep: improvementPrep ?? null,
      }
      if (!opts?.fromPrePromptRouter) {
        setAgentThinkingLine('Собираю параметры запроса…')
        await new Promise((r) => window.setTimeout(r, 280 + Math.random() * 900))
      } else {
        await new Promise((r) => window.setTimeout(r, 160 + Math.random() * 420))
      }
      setAgentThinkingLine('Отправляю запрос на сервер…')
      modelWaitTimer = window.setTimeout(() => {
        setAgentThinkingLine('Ожидание ответа модели…')
      }, 2200 + Math.random() * 4200)
      const res = normalizeClientGenerateResult(await api.generate(req), {
        keepIterationCompanionQuestions: isIteration && !improvementPrep,
      })
      if (modelWaitTimer) window.clearTimeout(modelWaitTimer)
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
          let prevMsgs = (snap.chatMessages || []) as StudioGenChatMsg[]
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
            chatMessages: nextMsgs as StudioChatMessage[],
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
      if (res.has_prompt && improvementWizardApplyRef.current) {
        improvementWizardApplyRef.current = null
      }
      setQuestionState({})
      setQuestionCarouselIdx(0)
      setQuickSaved(false)
      setPublishCommunityHintVisible(false)
      if (!opts?.skipAgentChatReplies) {
        setStudioChatMessages((prev) => {
          let base = prev as StudioGenChatMsg[]
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
              chatMessages: next as StudioChatMessage[],
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
          return next as StudioChatMessage[]
        })
      }
    } catch (e) {
      if (modelWaitTimer) window.clearTimeout(modelWaitTimer)
      setError(e instanceof Error ? e.message : 'Ошибка генерации')
    } finally {
      if (modelWaitTimer) window.clearTimeout(modelWaitTimer)
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
      setStudioChatMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', content: body }])
    }

    if (item.action === 'iterate') {
      const fb = item.data?.feedback?.trim() || item.title
      if (item.id === 'creative' || item.id === 'deep_improve') {
        improvementWizardApplyRef.current = { basePrompt: snapshot.prompt_block, feedback: fb }
        void handleGenerate(undefined, {
          taskInputOverride: taskRef,
          improvementPrep: item.id,
          previousPromptOverride: snapshot.prompt_block,
          forceIteration: false,
        })
        return
      }
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
          setPublishCommunityHintVisible(true)
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
          setPublishCommunityHintVisible(true)
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
      navigate({ pathname: '/compare', search: '?mode=techniques' }, { state: { taskInput: taskRef } })
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
        setResult((prev) => (prev ? mergeSessionVersionIntoResult(prev, latest, sid) : prev))
      }
      setStudioChatMessages((prev) => prev.filter((x) => x.id !== msgId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось применить правку.')
    } finally {
      setLoading(false)
    }
  }

  const handleEditPreviewCancel = (msgId: string) => {
    setStudioChatMessages((prev) => prev.filter((x) => x.id !== msgId))
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
    const timers: number[] = []
    let waitLong: number | undefined
    try {
      setPromptPlaygroundThinkingLine('Готовлю сообщение…')
      timers.push(window.setTimeout(() => setPromptPlaygroundThinkingLine('Отправляю в API песочницы…'), 380 + Math.random() * 700))
      waitLong = window.setTimeout(() => setPromptPlaygroundThinkingLine('Ожидание ответа модели…'), 2000 + Math.random() * 3800)
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
      timers.forEach((tid) => window.clearTimeout(tid))
      if (waitLong) window.clearTimeout(waitLong)
      setPromptPlaygroundThinkingLine('')
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
    const timers: number[] = []
    let waitLong: number | undefined
    try {
      setSkillSandboxThinkingLine('Готовлю сообщение…')
      timers.push(window.setTimeout(() => setSkillSandboxThinkingLine('Отправляю в API песочницы…'), 380 + Math.random() * 700))
      waitLong = window.setTimeout(() => setSkillSandboxThinkingLine('Ожидание ответа модели…'), 2000 + Math.random() * 3800)
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
      timers.forEach((tid) => window.clearTimeout(tid))
      if (waitLong) window.clearTimeout(waitLong)
      setSkillSandboxThinkingLine('')
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

  const prePromptForceContinue = useCallback(
    (pendingUserText: string, routerLogId?: number) => {
      const t = pendingUserText.trim()
      if (!t || loading) return
      void (async () => {
        setLoading(true)
        setError(null)
        setAgentThinkingLine(PRE_PROMPT_ROUTING_LINE)
        const chatHist = buildAgentChatHistory(chatMessages)
        try {
          const ac = new AbortController()
          const tid = window.setTimeout(() => ac.abort(), AGENT_PROCESS_PRE_TIMEOUT_MS)
          try {
            const res = await api.agentProcess(
              {
                text: t,
                has_prompt: false,
                prompt_type: promptType,
                chat_history: chatHist,
                expert_level: expertLevel,
                force_task: true,
                router_log_id: routerLogId,
              },
              { signal: ac.signal },
            )
            if (res.action === 'generate' || res.action === 'generate_skill') {
              setAgentThinkingLine(res.action === 'generate_skill' ? PRE_PROMPT_SKILL_LINE : PRE_PROMPT_TASK_LINE)
              setBaseTaskRef(t)
              setTaskInput(t)
              await handleGenerate(undefined, { taskInputOverride: t, fromPrePromptRouter: true })
              return
            }
            setAgentThinkingLine(PRE_PROMPT_TASK_LINE)
            setBaseTaskRef(t)
            setTaskInput(t)
            await handleGenerate(undefined, { taskInputOverride: t, fromPrePromptRouter: true })
          } finally {
            window.clearTimeout(tid)
          }
        } catch {
          setAgentThinkingLine(PRE_PROMPT_TASK_LINE)
          setBaseTaskRef(t)
          setTaskInput(t)
          await handleGenerate(undefined, { taskInputOverride: t, fromPrePromptRouter: true })
        }
      })()
    },
    [chatMessages, promptType, expertLevel, loading, handleGenerate],
  )

  const handleAgentSend = () => {
    const text = chatInput.trim()
    if (!text || loading) return
    if (result?.has_questions && !result?.has_prompt) {
      setError('Завершите уточнения в панели под чатом или нажмите «Подтвердить» на последнем вопросе.')
      return
    }
    setChatInput('')
    setStudioChatMessages((m) => [...m, { id: crypto.randomUUID(), role: 'user', content: text }])
    setError(null)

    if (isConversationalOnlyMessage(text, { promptType })) {
      if (result?.has_prompt) {
        setStudioChatMessages((m) => [
          ...m,
          { id: crypto.randomUUID(), role: 'assistant', content: pickAfterPromptChatReply() },
        ])
        return
      }
      void (async () => {
        setLoading(true)
        setError(null)
        try {
          const hist = buildAgentChatHistory([...chatMessages, { role: 'user', content: text }])
          const ac = new AbortController()
          const tid = window.setTimeout(() => ac.abort(), AGENT_PROCESS_PRE_TIMEOUT_MS)
          try {
            const res = await api.agentProcess(
              {
                text,
                has_prompt: false,
                prompt_type: promptType,
                chat_history: hist,
                expert_level: expertLevel,
              },
              { signal: ac.signal },
            )
            if (res.action === 'chat') {
              const msg =
                String((res.data as { message?: string }).message || '').trim() || pickConversationalReply()
              const isClar = Boolean(res.is_clarification)
              const clarifyReason =
                typeof res.clarify_reason === 'string' ? res.clarify_reason.trim() : ''
              const routerLogId = typeof res.router_log_id === 'number' ? res.router_log_id : undefined
              setStudioChatMessages((m) => [
                ...m,
                {
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  content: msg,
                  ...(isClar
                    ? {
                        routerClarification: {
                          reason: clarifyReason || undefined,
                          routerLogId,
                          pendingUserText: text,
                        },
                      }
                    : {}),
                },
              ])
              return
            }
            if (res.action === 'generate' || res.action === 'generate_skill') {
              setAgentThinkingLine(
                res.action === 'generate_skill' ? PRE_PROMPT_SKILL_LINE : PRE_PROMPT_TASK_LINE,
              )
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
          setStudioChatMessages((m) => [
            ...m,
            { id: crypto.randomUUID(), role: 'assistant', content: pickConversationalReply() },
          ])
        } finally {
          setLoading(false)
        }
      })()
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
            const diffOps = computeRefinedLineDiffOps(snapshot.prompt_block, r.new_prompt)
            setStudioChatMessages((prev) => [
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
            setStudioChatMessages((prev) => [
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
          expertLevel,
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
          setStudioChatMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'assistant', content }])
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
              setPublishCommunityHintVisible(true)
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
              setPublishCommunityHintVisible(true)
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
            navigate({ pathname: '/compare', search: '?mode=techniques' }, { state: { taskInput: taskRef } })
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
                expert_level: expertLevel,
              },
              { signal: ac.signal },
            )
            if (res.action === 'chat') {
              setAgentThinkingLine(null)
              const msg =
                String((res.data as { message?: string }).message || '').trim() || pickConversationalReply()
              const isClar = Boolean(res.is_clarification)
              const clarifyReason =
                typeof res.clarify_reason === 'string' ? res.clarify_reason.trim() : ''
              const routerLogId = typeof res.router_log_id === 'number' ? res.router_log_id : undefined
              setStudioChatMessages((m) => [
                ...m,
                {
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  content: msg,
                  ...(isClar
                    ? {
                        routerClarification: {
                          reason: clarifyReason || undefined,
                          routerLogId,
                          pendingUserText: text,
                        },
                      }
                    : {}),
                },
              ])
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

  const runImageTryNano = async () => {
    if (!result?.prompt_block || promptType !== 'image') return
    setImageTryBusy(true)
    try {
      const r = await api.imageTry({
        prompt_text: result.prompt_block,
        aspect_ratio: '1:1',
      })
      setImageTryDataUrl(r.image_url)
      setImageTryCoverPath(r.saved_path || null)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setStudioChatMessages((prev) => [
        ...prev,
        {
          id: `imgtry-err-${Date.now()}`,
          role: 'assistant',
          content: `Не удалось сделать пробную картинку: ${msg}`,
        },
      ])
    } finally {
      setImageTryBusy(false)
    }
  }

  const runLlmReview = async (forceRefresh = false) => {
    if (!result?.prompt_block) return
    setLlmReviewBusy(true)
    setLlmReviewOpen(true)
    setLlmReviewHintsOpen(false)
    setLlmReviewText('')
    setLlmReviewModel('')
    setLlmReviewFromCache(false)
    setLlmReviewHints([])
    const timers: number[] = []
    let waitLong: number | undefined
    try {
      setLlmReviewThinkingLine('Готовлю запрос к судье…')
      timers.push(window.setTimeout(() => setLlmReviewThinkingLine('Отправляю промпт на сервер…'), 400 + Math.random() * 700))
      waitLong = window.setTimeout(() => setLlmReviewThinkingLine('Ожидание ответа модели-судьи…'), 2200 + Math.random() * 4000)
      const r = await api.libraryLlmReview({
        prompt: result.prompt_block,
        prompt_type: promptType,
        original_task: (baseTaskRef || taskInput).trim(),
        force_refresh: forceRefresh,
      })
      setLlmReviewText(r.review)
      setLlmReviewModel(r.judge_model)
      setLlmReviewFromCache(Boolean(r.from_cache))
      setLlmReviewHints(Array.isArray(r.hints) ? r.hints : [])
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setLlmReviewText(`Ошибка: ${msg}`)
      setLlmReviewFromCache(false)
      setLlmReviewHints([])
    } finally {
      timers.forEach((tid) => window.clearTimeout(tid))
      if (waitLong) window.clearTimeout(waitLong)
      setLlmReviewThinkingLine('')
      setLlmReviewBusy(false)
    }
  }

  const handleSaveToLibrary = async () => {
    if (!result?.prompt_block) return
    const fb = (baseTaskRef || taskInput).trim()
    const title = saveTitle.trim() || pickPromptTitle(result, fb)
    if (promptType === 'skill') {
      const sk = appendLocalSkill({
        title,
        body: result.prompt_block,
        description: saveNotes.trim() || fb.slice(0, 500),
        tags: mergeStudioSkillTags(saveTags),
        frameworks: [],
      })
      void api
        .createSkill({
          name: sk.title,
          body: sk.body,
          description: sk.description,
          category: sk.tags[0] || 'general',
          client_local_id: sk.id,
        })
        .catch(() => {})
      window.dispatchEvent(new CustomEvent('metaprompt-nav-refresh'))
      setShowSaveDialog(false)
      setSaveNotes('')
      setSaveTags('')
      setQuickSaved(true)
      setPublishCommunityHintVisible(true)
      return
    }
    const completenessScore = (() => {
      const n = Number(result.metrics?.completeness_score ?? result.metrics?.quality_score ?? 0)
      return Number.isFinite(n) && n > 0 ? n : null
    })()
    const tokenEst = (() => {
      const n = Number(result.metrics?.token_estimate ?? 0)
      return Number.isFinite(n) && n > 0 ? Math.round(n) : null
    })()
    if (saveLibraryTarget === 'existing') {
      const exId = saveExistingLibraryId === '' ? 0 : Number(saveExistingLibraryId)
      if (!exId) {
        window.alert('Выберите карточку библиотеки или сохраните как новую.')
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
        cover_image_path: promptType === 'image' && imageTryCoverPath ? imageTryCoverPath : undefined,
        completeness_score: completenessScore,
        token_estimate: tokenEst,
        existing_library_id: exId,
        version_mode: saveVersionAction,
      })
    } else {
      await api.saveToLibrary({
        title,
        prompt: result.prompt_block,
        tags: saveTags.split(',').map((t) => t.trim()).filter(Boolean),
        target_model: effectiveTargetModel,
        task_type: result.task_types?.[0] || 'general',
        techniques: result.technique_ids,
        notes: saveNotes,
        cover_image_path: promptType === 'image' && imageTryCoverPath ? imageTryCoverPath : undefined,
        completeness_score: completenessScore,
        token_estimate: tokenEst,
        version_mode: 'new_card',
      })
    }
    window.dispatchEvent(new CustomEvent('metaprompt-nav-refresh'))
    setShowSaveDialog(false)
    setSaveNotes('')
    setSaveTags('')
    setQuickSaved(true)
    setPublishCommunityHintVisible(true)
  }

  const handleQuickSave = async () => {
    if (!result?.prompt_block) return
    const fb = (baseTaskRef || taskInput).trim()
    const title = pickPromptTitle(result, fb)
    if (promptType === 'skill') {
      const sk = appendLocalSkill({
        title,
        body: result.prompt_block,
        description: fb.slice(0, 500),
        tags: mergeStudioSkillTags(saveTags),
        frameworks: [],
      })
      void api
        .createSkill({
          name: sk.title,
          body: sk.body,
          description: sk.description,
          category: sk.tags[0] || 'general',
          client_local_id: sk.id,
        })
        .catch(() => {})
      window.dispatchEvent(new CustomEvent('metaprompt-nav-refresh'))
      setQuickSaved(true)
      setPublishCommunityHintVisible(true)
      return
    }
    await api.saveToLibrary({
      title,
      prompt: result.prompt_block,
      tags: saveTags.split(',').map((t) => t.trim()).filter(Boolean),
      target_model: effectiveTargetModel,
      task_type: result.task_types?.[0] || 'general',
      techniques: result.technique_ids,
      cover_image_path: promptType === 'image' && imageTryCoverPath ? imageTryCoverPath : undefined,
    })
    window.dispatchEvent(new CustomEvent('metaprompt-nav-refresh'))
    setQuickSaved(true)
    setPublishCommunityHintVisible(true)
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
      prefilled_image_path: promptType === 'image' && imageTryCoverPath ? imageTryCoverPath : null,
      prefilled_image_data_url:
        promptType === 'image' && imageTryDataUrl && !imageTryCoverPath ? imageTryDataUrl : null,
    }),
    [taskInput, taskRefForTitles, result, result?.prompt_block, promptType, imageTryCoverPath, imageTryDataUrl],
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
        label: t.expertLevels.labels[el],
        title: `${t.expertLevels.hints[el]} · ${getLevelBundleForExpertLevel(el).estimatedCostHint}`,
      })),
    [t],
  )

  const activeLevelBundle = useMemo(() => {
    const b = getLevelBundleForExpertLevel(expertLevel)
    const pack = t.studio.levelBundles[b.id]
    return { ...b, label: pack.label, description: pack.description }
  }, [expertLevel, t])

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

  const showSeedExample = useMemo(
    () =>
      getRecentSessions().length === 0 &&
      !result?.has_prompt &&
      chatMessages.length <= 1 &&
      !taskInput.trim() &&
      !loading,
    [result?.has_prompt, chatMessages.length, taskInput, loading],
  )

  const handleGenerateRef = useRef(handleGenerate)
  handleGenerateRef.current = handleGenerate

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isModEnter(e)) {
        e.preventDefault()
        void handleGenerateRef.current()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '/') {
        e.preventDefault()
        document.querySelector<HTMLTextAreaElement>('[data-studio-composer]')?.focus()
        return
      }
      if (e.key === 'Escape') {
        if (result?.has_prompt) {
          setResult(null)
          setError(null)
          return
        }
        ;(document.activeElement as HTMLElement | null)?.blur()
        return
      }
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
          e.preventDefault()
          setHotkeysOpen(true)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [result?.has_prompt])

  const agentChatPlaceholder = useMemo(() => {
    if (promptType === 'image') {
      return 'Сначала опишите сцену или идею. Стили и уточнения — строкой выше, когда понадобятся.'
    }
    if (promptType === 'skill') {
      return 'Опишите, какой навык или инструкцию оформить для ИИ-ассистента (роль, шаги, формат ответа)…'
    }
    return 'Опишите задачу или попросите изменить промпт…'
  }, [promptType])

  const questionGenOpts: StudioGenerateOptions | undefined = (baseTaskRef || taskInput).trim()
    ? { taskInputOverride: (baseTaskRef || taskInput).trim() }
    : undefined

  const questionsPanel = (
    <StudioQuestionsWizard
      result={result}
      loading={loading}
      questionCarouselIdx={questionCarouselIdx}
      setQuestionCarouselIdx={setQuestionCarouselIdx}
      questionState={questionState}
      setQuestionState={setQuestionState}
      questionGenOpts={questionGenOpts}
      improvementWizardApplyRef={improvementWizardApplyRef}
      onGenerate={handleGenerate}
    />
  )



  return (
    <div className={`${styles.home} ${styles.homeFlexFill}`}>
      <HomeOnboardingHints />
      <FirstVisitHomeTip />
      <div ref={agentSplitRootRef} className={`${styles.splitRoot} ${styles.splitRootFill}`}>
          <div
            className={`${styles.splitPane} ${styles.splitPaneAgentChat}`}
            style={{ flex: `${agentSplit} 1 0%`, minWidth: 0 }}
          >
            <div className={styles.agentChatColumn}>
              <StudioAgentChatHeader
                t={t}
                promptType={promptType}
                loading={loading}
                handlePromptTypeChange={handlePromptTypeChange}
                expertLevel={expertLevel}
                expertLevelSelectOptions={expertLevelSelectOptions}
                handleExpertLevelChange={handleExpertLevelChange}
                useCustomGenModel={useCustomGenModel}
                genModel={genModel}
                shortGenerationModelLabel={shortGenerationModelLabel}
                setUseCustomGenModel={setUseCustomGenModel}
                setGenModel={setGenModel}
                resetAgentDialog={resetAgentDialog}
                taskRefForTitles={taskRefForTitles}
                taskTextTokensLoading={taskTextTokensLoading}
                taskTextTokens={taskTextTokens}
                imagePromptTags={imagePromptTags}
                toggleImageTag={toggleImageTag}
                imageStyleMoreBtnRef={imageStyleMoreBtnRef}
                imageStylePickerOpen={imageStylePickerOpen}
                setImageStylePickerOpen={setImageStylePickerOpen}
                imageDeepMode={imageDeepMode}
                setImageDeepMode={setImageDeepMode}
                chatMessages={chatMessages}
                setChatInput={setChatInput}
              />
              <div className={styles.agentChatBody}>
                <div
                  ref={agentChatScrollRef}
                  className={styles.agentChatScroll}
                  aria-live="polite"
                  aria-relevant="additions"
                >
                  <StudioAgentChatMessageList
                    chatMessages={chatMessages}
                    loading={loading}
                    error={error}
                    thinkingStreamText={thinkingStreamText}
                    latestVersionInChat={latestVersionInChat}
                    promptDoneFullDiffMsgId={promptDoneFullDiffMsgId}
                    setPromptDoneFullDiffMsgId={setPromptDoneFullDiffMsgId}
                    handleEditPreviewApply={handleEditPreviewApply}
                    handleEditPreviewCancel={handleEditPreviewCancel}
                    setVersionRestoreConfirm={setVersionRestoreConfirm}
                    hoveredPromptSuggestion={hoveredPromptSuggestion}
                    setHoveredPromptSuggestion={setHoveredPromptSuggestion}
                    handleGenerate={handleGenerate}
                    result={result}
                    promptType={promptType}
                    setSkillSandboxLog={setSkillSandboxLog}
                    setSkillSandboxInput={setSkillSandboxInput}
                    setSkillSandboxOpen={setSkillSandboxOpen}
                    skillTestRunning={skillTestRunning}
                    skillTestResults={skillTestResults}
                    runSkillTestCases={runSkillTestCases}
                    prePromptForceContinue={prePromptForceContinue}
                  />
                </div>
              </div>
              <StudioAgentComposer
                result={result}
                loading={loading}
                suggestedActions={suggestedActions}
                suggestionsBarExpanded={suggestionsBarExpanded}
                setSuggestionsBarExpanded={setSuggestionsBarExpanded}
                handleSuggestedActionClick={handleSuggestedActionClick}
                questionFollowupOpen={questionFollowupOpen}
                setQuestionFollowupOpen={setQuestionFollowupOpen}
                questionsPanel={questionsPanel}
                chatInput={chatInput}
                setChatInput={setChatInput}
                handleAgentSend={handleAgentSend}
                agentChatPlaceholder={agentChatPlaceholder}
                showSeedExample={showSeedExample}
                onLoadSeedExample={(task) => {
                  setChatInput(task)
                  setTaskInput(task)
                }}
                activeLevelBundle={activeLevelBundle}
                tier={tier}
                setTier={setTier}
                setUseCustomGenModel={setUseCustomGenModel}
                genModel={genModel}
                genModelSelectOptions={genModelSelectOptions}
                setGenModel={setGenModel}
                workspaces={workspaces}
                workspaceId={workspaceId}
                setWorkspaceId={setWorkspaceId}
                workspacesReady={workspacesReady}
                promptType={promptType}
                imagePresetId={imagePresetId}
                imagePresetSelectOptions={imagePresetSelectOptions}
                setImagePresetId={setImagePresetId}
                skillPresetId={skillPresetId}
                skillPresetSelectOptions={skillPresetSelectOptions}
                setSkillPresetId={setSkillPresetId}
                skillTargetEnv={skillTargetEnv}
                skillTargetEnvSelectOptions={skillTargetEnvSelectOptions}
                setSkillTargetEnv={setSkillTargetEnv}
                targetModel={targetModel}
                targetModelSelectOptions={targetModelSelectOptions}
                setTargetModel={setTargetModel}
                techniqueMode={techniqueMode}
                setTechniqueMode={setTechniqueMode}
                expertLevel={expertLevel}
                manualTechPickerCollapsed={manualTechPickerCollapsed}
                setManualTechPickerCollapsed={setManualTechPickerCollapsed}
                manualTechHintDismissed={manualTechHintDismissed}
                setManualTechHintDismissed={setManualTechHintDismissed}
                showAdvanced={showAdvanced}
                setShowAdvanced={setShowAdvanced}
                techniques={techniques}
                techMenuFilter={techMenuFilter}
                setTechMenuFilter={setTechMenuFilter}
                manualTechs={manualTechs}
                setManualTechs={setManualTechs}
                temperature={temperature}
                setTemperature={setTemperature}
                topP={topP}
                setTopP={setTopP}
                topK={topK}
                setTopK={setTopK}
                questionsMode={questionsMode}
                setQuestionsMode={setQuestionsMode}
                skillBody={skillBody}
                setSkillBody={setSkillBody}
                localSkillsForPicker={localSkillsForPicker}
                skillInsertOpen={skillInsertOpen}
                setSkillInsertOpen={setSkillInsertOpen}
                skillInsertBtnRef={skillInsertBtnRef}
              />
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
            <StudioResultPanel
              promptType={promptType}
              result={result}
              error={error}
              loading={loading}
              issueBannerDismissed={issueBannerDismissed}
              setIssueBannerDismissed={setIssueBannerDismissed}
              handleRetryGeneration={handleRetryGeneration}
              streamedPromptIde={streamedPromptIde}
              tokenEstimate={tokenEstimate}
              promptCostStr={promptCostStr}
              navigate={navigate}
              taskInput={taskInput}
              taskRefForTitles={taskRefForTitles}
              setChatInput={setChatInput}
              showSaveDialog={showSaveDialog}
              setShowSaveDialog={setShowSaveDialog}
              saveTitle={saveTitle}
              setSaveTitle={setSaveTitle}
              saveTags={saveTags}
              setSaveTags={setSaveTags}
              saveNotes={saveNotes}
              setSaveNotes={setSaveNotes}
              saveLibraryTarget={saveLibraryTarget}
              setSaveLibraryTarget={setSaveLibraryTarget}
              saveExistingLibraryId={saveExistingLibraryId}
              setSaveExistingLibraryId={setSaveExistingLibraryId}
              saveVersionAction={saveVersionAction}
              setSaveVersionAction={setSaveVersionAction}
              librarySaveOptions={librarySaveOptions}
              handleSaveToLibrary={handleSaveToLibrary}
              handleQuickSave={handleQuickSave}
              versions={versions}
              sessionId={sessionId}
              setResult={setResult}
              mergeSessionVersionIntoResult={mergeSessionVersionIntoResult}
              imageTryDataUrl={imageTryDataUrl}
              imageTryBusy={imageTryBusy}
              runImageTryNano={runImageTryNano}
              llmReviewBusy={llmReviewBusy}
              runLlmReview={runLlmReview}
              setPublishCommunityOpen={setPublishCommunityOpen}
              publishCommunityHintVisible={publishCommunityHintVisible}
              setPublishCommunityHintVisible={setPublishCommunityHintVisible}
              quickSaved={quickSaved}
              pickPromptTitle={pickPromptTitle}
              setPromptPlaygroundLog={setPromptPlaygroundLog}
              setPromptPlaygroundInput={setPromptPlaygroundInput}
              setPromptPlaygroundOpen={setPromptPlaygroundOpen}
            />
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
      <StudioLlmReviewDock
        llmReviewOpen={llmReviewOpen}
        llmReviewMaximized={llmReviewMaximized}
        setLlmReviewMaximized={setLlmReviewMaximized}
        setLlmReviewOpen={setLlmReviewOpen}
        llmReviewBusy={llmReviewBusy}
        llmReviewThinkingLine={llmReviewThinkingLine}
        llmReviewModel={llmReviewModel}
        llmReviewFromCache={llmReviewFromCache}
        streamedLlmReviewBody={streamedLlmReviewBody}
        llmReviewText={llmReviewText}
        llmReviewHints={llmReviewHints}
        llmReviewHintsOpen={llmReviewHintsOpen}
        setLlmReviewHintsOpen={setLlmReviewHintsOpen}
        loading={loading}
        setChatInput={setChatInput}
        runLlmReview={runLlmReview}
      />
      <StudioModals
        versionRestoreConfirm={versionRestoreConfirm}
        setVersionRestoreConfirm={setVersionRestoreConfirm}
        versions={versions}
        sessionId={sessionId}
        result={result}
        setResult={setResult}
        promptPlaygroundOpen={promptPlaygroundOpen}
        setPromptPlaygroundOpen={setPromptPlaygroundOpen}
        promptPlaygroundBusy={promptPlaygroundBusy}
        promptPlaygroundThinkingLine={promptPlaygroundThinkingLine}
        promptPlaygroundLog={promptPlaygroundLog}
        promptPlaygroundInput={promptPlaygroundInput}
        setPromptPlaygroundInput={setPromptPlaygroundInput}
        onSendPromptPlayground={sendPromptPlaygroundMessage}
        skillSandboxOpen={skillSandboxOpen}
        setSkillSandboxOpen={setSkillSandboxOpen}
        skillSandboxBusy={skillSandboxBusy}
        skillSandboxThinkingLine={skillSandboxThinkingLine}
        skillSandboxLog={skillSandboxLog}
        skillSandboxInput={skillSandboxInput}
        setSkillSandboxInput={setSkillSandboxInput}
        onSendSkillSandbox={sendSkillSandboxMessage}
      />
      <HotkeysCheatsheet open={hotkeysOpen} onClose={() => setHotkeysOpen(false)} />
    </div>
  )
}
