import type { Dispatch, ReactNode, RefObject, SetStateAction } from 'react'
import type { NavigateFunction } from 'react-router-dom'
import type { GenerateResult, LibraryItem, SuggestedStudioAction, Workspace } from '../../api/client'
import type { SelectOption } from '../../components/SelectDropdown'
import type { TierValue } from '../../components/TierSelector'
import type { Dict } from '../../i18n'
import type { ExpertLevel } from '../../lib/agentStudioModes'
import type { StudioChatMessage, StudioGenChatMsg } from './homeHelpers'

export type StudioSandboxLogRow = { role: 'user' | 'assistant'; content: string }

export type StudioGenerateOptions = {
  taskInputOverride?: string
  feedbackOverride?: string
  forceIteration?: boolean
  previousPromptOverride?: string
  improvementPrep?: 'creative' | 'deep_improve'
  skipAgentChatReplies?: boolean
  chatAppendBeforeResult?: StudioGenChatMsg[]
  fromPrePromptRouter?: boolean
}

export type StudioHandleGenerate = (
  questionAnswers?: { question: string; answers: string[] }[],
  opts?: StudioGenerateOptions,
) => void | Promise<void>

export type StudioPromptType = 'text' | 'image' | 'skill'

export type StudioResultPanelProps = {
  promptType: StudioPromptType
  result: GenerateResult | null
  error: string | null
  loading: boolean
  issueBannerDismissed: boolean
  setIssueBannerDismissed: Dispatch<SetStateAction<boolean>>
  handleRetryGeneration: () => void
  streamedPromptIde: string
  tokenEstimate: number
  promptCostStr: string | null
  navigate: NavigateFunction
  taskInput: string
  taskRefForTitles: string
  setChatInput: Dispatch<SetStateAction<string>>
  showSaveDialog: boolean
  setShowSaveDialog: Dispatch<SetStateAction<boolean>>
  saveTitle: string
  setSaveTitle: Dispatch<SetStateAction<string>>
  saveTags: string
  setSaveTags: Dispatch<SetStateAction<string>>
  saveNotes: string
  setSaveNotes: Dispatch<SetStateAction<string>>
  saveLibraryTarget: 'new' | 'existing'
  setSaveLibraryTarget: Dispatch<SetStateAction<'new' | 'existing'>>
  saveExistingLibraryId: number | ''
  setSaveExistingLibraryId: Dispatch<SetStateAction<number | ''>>
  saveVersionAction: 'replace_latest' | 'append'
  setSaveVersionAction: Dispatch<SetStateAction<'replace_latest' | 'append'>>
  librarySaveOptions: LibraryItem[]
  handleSaveToLibrary: () => void
  handleQuickSave: () => void
  versions: unknown[]
  sessionId: string | null
  setResult: Dispatch<SetStateAction<GenerateResult | null>>
  mergeSessionVersionIntoResult: (
    prev: GenerateResult | null,
    row: Record<string, unknown>,
    sessionId: string,
  ) => GenerateResult
  imageTryDataUrl: string | null
  imageTryBusy: boolean
  runImageTryNano: () => void | Promise<void>
  llmReviewBusy: boolean
  runLlmReview: (force?: boolean) => void | Promise<void>
  setPublishCommunityOpen: Dispatch<SetStateAction<boolean>>
  publishCommunityHintVisible: boolean
  setPublishCommunityHintVisible: Dispatch<SetStateAction<boolean>>
  quickSaved: boolean
  pickPromptTitle: (result: GenerateResult, taskRef: string) => string
  setPromptPlaygroundLog: Dispatch<SetStateAction<StudioSandboxLogRow[]>>
  setPromptPlaygroundInput: Dispatch<SetStateAction<string>>
  setPromptPlaygroundOpen: Dispatch<SetStateAction<boolean>>
}

export type StudioAgentChatMessageListProps = {
  chatMessages: StudioChatMessage[]
  loading: boolean
  error: string | null
  thinkingStreamText: string
  latestVersionInChat: number
  promptDoneFullDiffMsgId: string | null
  setPromptDoneFullDiffMsgId: Dispatch<SetStateAction<string | null>>
  handleEditPreviewApply: (msgId: string, newPrompt: string) => void | Promise<void>
  handleEditPreviewCancel: (msgId: string) => void
  setVersionRestoreConfirm: Dispatch<
    SetStateAction<{ version: number; prompt: string } | null>
  >
  hoveredPromptSuggestion: { msgId: string; index: number } | null
  setHoveredPromptSuggestion: Dispatch<SetStateAction<{ msgId: string; index: number } | null>>
  handleGenerate: StudioHandleGenerate
  result: GenerateResult | null
  promptType: StudioPromptType
  setSkillSandboxLog: Dispatch<SetStateAction<StudioSandboxLogRow[]>>
  setSkillSandboxInput: Dispatch<SetStateAction<string>>
  setSkillSandboxOpen: Dispatch<SetStateAction<boolean>>
  skillTestRunning: boolean
  skillTestResults: Record<number, 'pass' | 'fail'>
  runSkillTestCases: (
    cases: { user: string; expect_substring: string }[],
  ) => void | Promise<void>
  prePromptForceContinue: (pendingUserText: string, routerLogId?: number) => void
}

export type StudioAgentChatHeaderProps = {
  t: Dict
  promptType: StudioPromptType
  loading: boolean
  handlePromptTypeChange: (pt: StudioPromptType) => void
  expertLevel: ExpertLevel
  expertLevelSelectOptions: SelectOption[]
  handleExpertLevelChange: (level: ExpertLevel) => void
  useCustomGenModel: boolean
  genModel: string
  shortGenerationModelLabel: (id: string) => string
  setUseCustomGenModel: Dispatch<SetStateAction<boolean>>
  setGenModel: Dispatch<SetStateAction<string>>
  resetAgentDialog: () => void
  taskRefForTitles: string
  taskTextTokensLoading: boolean
  taskTextTokens: { tokens: number } | null
  imagePromptTags: string[]
  toggleImageTag: (id: string) => void
  imageStyleMoreBtnRef: RefObject<HTMLButtonElement>
  imageStylePickerOpen: boolean
  setImageStylePickerOpen: Dispatch<SetStateAction<boolean>>
  imageDeepMode: boolean
  setImageDeepMode: Dispatch<SetStateAction<boolean>>
  chatMessages: StudioChatMessage[]
  setChatInput: Dispatch<SetStateAction<string>>
}

export type StudioAgentComposerProps = {
  result: GenerateResult | null
  loading: boolean
  suggestedActions: SuggestedStudioAction[]
  suggestionsBarExpanded: boolean
  setSuggestionsBarExpanded: Dispatch<SetStateAction<boolean>>
  handleSuggestedActionClick: (action: SuggestedStudioAction) => void | Promise<void>
  questionFollowupOpen: boolean
  setQuestionFollowupOpen: Dispatch<SetStateAction<boolean>>
  questionsPanel: ReactNode
  chatInput: string
  setChatInput: Dispatch<SetStateAction<string>>
  handleAgentSend: () => void
  agentChatPlaceholder: string
  showSeedExample?: boolean
  onLoadSeedExample?: (task: string) => void
  activeLevelBundle: { label: string; estimatedCalls: number; estimatedCostHint: string }
  tier: TierValue
  setTier: Dispatch<SetStateAction<TierValue>>
  setUseCustomGenModel: Dispatch<SetStateAction<boolean>>
  genModel: string
  genModelSelectOptions: SelectOption[]
  setGenModel: Dispatch<SetStateAction<string>>
  workspaces: Workspace[]
  workspaceId: number
  setWorkspaceId: Dispatch<SetStateAction<number>>
  workspacesReady: boolean
  promptType: StudioPromptType
  imagePresetId: string
  imagePresetSelectOptions: SelectOption[]
  setImagePresetId: Dispatch<SetStateAction<string>>
  skillPresetId: string
  skillPresetSelectOptions: SelectOption[]
  setSkillPresetId: Dispatch<SetStateAction<string>>
  skillTargetEnv: string
  skillTargetEnvSelectOptions: SelectOption[]
  setSkillTargetEnv: Dispatch<SetStateAction<string>>
  targetModel: string
  targetModelSelectOptions: SelectOption[]
  setTargetModel: Dispatch<SetStateAction<string>>
  techniqueMode: 'auto' | 'manual'
  setTechniqueMode: Dispatch<SetStateAction<'auto' | 'manual'>>
  expertLevel: ExpertLevel
  manualTechPickerCollapsed: boolean
  setManualTechPickerCollapsed: Dispatch<SetStateAction<boolean>>
  manualTechHintDismissed: boolean
  setManualTechHintDismissed: Dispatch<SetStateAction<boolean>>
  showAdvanced: boolean
  setShowAdvanced: Dispatch<SetStateAction<boolean>>
  techniques: { id: string; name: string }[]
  techMenuFilter: string
  setTechMenuFilter: Dispatch<SetStateAction<string>>
  manualTechs: string[]
  setManualTechs: Dispatch<SetStateAction<string[]>>
  temperature: number
  setTemperature: Dispatch<SetStateAction<number>>
  topP: number
  setTopP: Dispatch<SetStateAction<number>>
  topK: number | ''
  setTopK: Dispatch<SetStateAction<number | ''>>
  questionsMode: boolean
  setQuestionsMode: Dispatch<SetStateAction<boolean>>
  skillBody: string
  setSkillBody: Dispatch<SetStateAction<string>>
  localSkillsForPicker: { id: string; title: string; body?: string; description?: string }[]
  skillInsertOpen: boolean
  setSkillInsertOpen: Dispatch<SetStateAction<boolean>>
  skillInsertBtnRef: RefObject<HTMLButtonElement>
}

export type StudioLlmReviewDockProps = {
  llmReviewOpen: boolean
  llmReviewMaximized: boolean
  setLlmReviewMaximized: Dispatch<SetStateAction<boolean>>
  setLlmReviewOpen: Dispatch<SetStateAction<boolean>>
  llmReviewBusy: boolean
  llmReviewThinkingLine: string
  llmReviewModel: string
  llmReviewFromCache: boolean
  streamedLlmReviewBody: string
  llmReviewText: string
  llmReviewHints: string[]
  llmReviewHintsOpen: boolean
  setLlmReviewHintsOpen: Dispatch<SetStateAction<boolean>>
  loading: boolean
  setChatInput: Dispatch<SetStateAction<string>>
  runLlmReview: (force?: boolean) => void | Promise<void>
}

export type StudioAgentColumnProps = StudioAgentChatHeaderProps &
  StudioAgentChatMessageListProps & {
    agentChatScrollRef: RefObject<HTMLDivElement>
  } & StudioAgentComposerProps
