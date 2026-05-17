import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/features/studio')

function readBody(file) {
  return fs.readFileSync(path.join(dir, file), 'utf8')
}

function emit(filename, componentName, propsTypeName, imports, bodyFile, destructureList) {
  const body = readBody(bodyFile)
  const content = `${imports}

export function ${componentName}(props: ${propsTypeName}) {
  const {
    ${destructureList.join(',\n    ')},
  } = props

  return (
${body}
  )
}
`
  fs.writeFileSync(path.join(dir, filename), content, 'utf8')
  console.log('wrote', filename)
}

emit(
  'StudioResultPanel.tsx',
  'StudioResultPanel',
  'StudioResultPanelProps',
  `import MarkdownOutput from '../../components/MarkdownOutput'
import ThemedTooltip from '../../components/ThemedTooltip'
import TranslateButton from '../../components/TranslateButton'
import { CopyIconButton, TryInGeminiButton } from '../../components/PromptToolbarIcons'
import {
  COMPLETENESS_SCORE_TITLE,
  PROMPT_COST_TITLE,
  TECHNIQUES_COUNT_TITLE,
  TOKEN_ESTIMATE_TITLE,
} from '../../lib/scoreTooltips'
import { GENERATION_ISSUE_TEXT } from './studioGenerationIssues'
import type { StudioResultPanelProps } from './studioUiTypes'
import styles from '../../pages/Home.module.css'`,
  'StudioResultPanel.body.txt',
  [
    'promptType',
    'result',
    'error',
    'loading',
    'issueBannerDismissed',
    'setIssueBannerDismissed',
    'handleRetryGeneration',
    'streamedPromptIde',
    'tokenEstimate',
    'promptCostStr',
    'navigate',
    'taskInput',
    'taskRefForTitles',
    'setChatInput',
    'showSaveDialog',
    'setShowSaveDialog',
    'saveTitle',
    'setSaveTitle',
    'saveTags',
    'setSaveTags',
    'saveNotes',
    'setSaveNotes',
    'saveLibraryTarget',
    'setSaveLibraryTarget',
    'saveExistingLibraryId',
    'setSaveExistingLibraryId',
    'saveVersionAction',
    'setSaveVersionAction',
    'librarySaveOptions',
    'handleSaveToLibrary',
    'handleQuickSave',
    'versions',
    'sessionId',
    'setResult',
    'mergeSessionVersionIntoResult',
    'imageTryDataUrl',
    'imageTryBusy',
    'runImageTryNano',
    'llmReviewBusy',
    'runLlmReview',
    'setPublishCommunityOpen',
    'publishCommunityHintVisible',
    'setPublishCommunityHintVisible',
    'quickSaved',
    'pickPromptTitle',
    'setPromptPlaygroundLog',
    'setPromptPlaygroundInput',
    'setPromptPlaygroundOpen',
  ],
)

emit(
  'StudioAgentChatMessageList.tsx',
  'StudioAgentChatMessageList',
  'StudioAgentChatMessageListProps',
  `import ThemedTooltip from '../../components/ThemedTooltip'
import { StreamedMarkdownOutput } from '../../lib/simulatedLlmStream'
import { computeRefinedLineDiffOps } from '../../lib/lineDiffLcs'
import type { StudioGenChatMsg } from './homeHelpers'
import type { StudioAgentChatMessageListProps } from './studioUiTypes'
import styles from '../../pages/Home.module.css'`,
  'StudioAgentChatMessageList.body.txt',
  [
    'chatMessages',
    'loading',
    'error',
    'thinkingStreamText',
    'latestVersionInChat',
    'promptDoneFullDiffMsgId',
    'setPromptDoneFullDiffMsgId',
    'handleEditPreviewApply',
    'handleEditPreviewCancel',
    'setVersionRestoreConfirm',
    'hoveredPromptSuggestion',
    'setHoveredPromptSuggestion',
    'handleGenerate',
    'result',
    'promptType',
    'setSkillSandboxLog',
    'setSkillSandboxInput',
    'setSkillSandboxOpen',
    'skillTestRunning',
    'skillTestResults',
    'runSkillTestCases',
    'prePromptForceContinue',
  ],
  `  // chatMessages mapped as m`,
)

// Fix message list - body starts with `{chatMessages.map` - need to wrap
let msgFile = fs.readFileSync(path.join(dir, 'StudioAgentChatMessageList.tsx'), 'utf8')
if (!msgFile.includes('chatMessages.map')) {
  const body = readBody('StudioAgentChatMessageList.body.txt')
  msgFile = msgFile.replace(
    '  return (\n' + body,
    '  return (\n    <>\n' + body + '\n    </>',
  )
  fs.writeFileSync(path.join(dir, 'StudioAgentChatMessageList.tsx'), msgFile)
}

emit(
  'StudioAgentChatHeader.tsx',
  'StudioAgentChatHeader',
  'StudioAgentChatHeaderProps',
  `import SelectDropdown from '../../components/SelectDropdown'
import ThemedTooltip from '../../components/ThemedTooltip'
import { EXPERT_DEFAULT_GEN_MODEL } from '../../lib/expertLevelPresets'
import { IMAGE_STYLES_BY_ID } from '../../lib/imageStyles'
import type { StudioAgentChatHeaderProps } from './studioUiTypes'
import styles from '../../pages/Home.module.css'`,
  'StudioAgentChatHeader.body.txt',
  [
    't',
    'promptType',
    'loading',
    'handlePromptTypeChange',
    'expertLevel',
    'expertLevelSelectOptions',
    'handleExpertLevelChange',
    'useCustomGenModel',
    'genModel',
    'shortGenerationModelLabel',
    'setUseCustomGenModel',
    'setGenModel',
    'resetAgentDialog',
    'taskRefForTitles',
    'taskTextTokensLoading',
    'taskTextTokens',
    'imagePromptTags',
    'toggleImageTag',
    'imageStyleMoreBtnRef',
    'imageStylePickerOpen',
    'setImageStylePickerOpen',
    'imageDeepMode',
    'setImageDeepMode',
    'chatMessages',
    'setChatInput',
  ],
)

emit(
  'StudioAgentComposer.tsx',
  'StudioAgentComposer',
  'StudioAgentComposerProps',
  `import AutoTextarea from '../../components/AutoTextarea'
import PortalDropdown from '../../components/PortalDropdown'
import SelectDropdown from '../../components/SelectDropdown'
import ThemedTooltip from '../../components/ThemedTooltip'
import TierSelector from '../../components/TierSelector'
import WorkspacePicker from '../../components/WorkspacePicker'
import {
  clampExpertGenerationTemperature,
  EXPERT_GENERATION_TEMPERATURE_CAP,
  expertLevelUsesManualTechniqueHint,
} from '../../lib/expertLevelPresets'
import { isReasoningModelId } from '../../lib/modelReasoning'
import { IconGlobe } from './StudioIcons'
import type { StudioAgentComposerProps } from './studioUiTypes'
import styles from '../../pages/Home.module.css'
import cb from '../../styles/ComposerBar.module.css'
import menuStyles from '../../components/DropdownMenu.module.css'`,
  'StudioAgentComposer.body.txt',
  [
    'result',
    'loading',
    'suggestedActions',
    'suggestionsBarExpanded',
    'setSuggestionsBarExpanded',
    'handleSuggestedActionClick',
    'questionFollowupOpen',
    'setQuestionFollowupOpen',
    'renderQuestionsPanel',
    'chatInput',
    'setChatInput',
    'handleAgentSend',
    'agentChatPlaceholder',
    'activeLevelBundle',
    'tier',
    'setTier',
    'setUseCustomGenModel',
    'genModel',
    'genModelSelectOptions',
    'setGenModel',
    'workspaces',
    'workspaceId',
    'setWorkspaceId',
    'workspacesReady',
    'promptType',
    'imagePresetId',
    'imagePresetSelectOptions',
    'setImagePresetId',
    'skillPresetId',
    'skillPresetSelectOptions',
    'setSkillPresetId',
    'skillTargetEnv',
    'skillTargetEnvSelectOptions',
    'setSkillTargetEnv',
    'targetModel',
    'targetModelSelectOptions',
    'setTargetModel',
    'techniqueMode',
    'setTechniqueMode',
    'expertLevel',
    'manualTechPickerCollapsed',
    'setManualTechPickerCollapsed',
    'manualTechHintDismissed',
    'setManualTechHintDismissed',
    'showAdvanced',
    'setShowAdvanced',
    'techniques',
    'techMenuFilter',
    'setTechMenuFilter',
    'manualTechs',
    'setManualTechs',
    'temperature',
    'setTemperature',
    'topP',
    'setTopP',
    'topK',
    'setTopK',
    'questionsMode',
    'setQuestionsMode',
    'skillBody',
    'setSkillBody',
    'localSkillsForPicker',
    'skillInsertOpen',
    'setSkillInsertOpen',
    'skillInsertBtnRef',
  ],
)

emit(
  'StudioLlmReviewDock.tsx',
  'StudioLlmReviewDock',
  'StudioLlmReviewDockProps',
  `import { createPortal } from 'react-dom'
import MarkdownOutput from '../../components/MarkdownOutput'
import ThemedTooltip from '../../components/ThemedTooltip'
import { LLM_REVIEW_DOCK_HELP } from './studioHomeConstants'
import { LlmReviewIconClose, LlmReviewIconMaximize, LlmReviewIconRestore } from './LlmReviewIcons'
import type { StudioLlmReviewDockProps } from './studioUiTypes'
import styles from '../../pages/Home.module.css'`,
  'StudioLlmReviewDock.body.txt',
  [
    'llmReviewMaximized',
    'setLlmReviewMaximized',
    'setLlmReviewOpen',
    'llmReviewBusy',
    'llmReviewThinkingLine',
    'llmReviewModel',
    'llmReviewFromCache',
    'streamedLlmReviewBody',
    'llmReviewText',
    'llmReviewHints',
    'llmReviewHintsOpen',
    'setLlmReviewHintsOpen',
    'loading',
    'setChatInput',
    'runLlmReview',
  ],
)

// LlmReview body file includes outer createPortal wrapper - check
let llm = fs.readFileSync(path.join(dir, 'StudioLlmReviewDock.body.txt'), 'utf8')
if (llm.trimStart().startsWith('<motion')) {
  // already inner card only from extraction 3755 - check first line
}
console.log('done')
