import type { GenerateResult } from '../api/client'
import type { AgentStudioSnapshot, PromptStudioMode } from './agentStudioModes'
import { createEmptyStudioSnapshot } from './agentStudioModes'
import type { PromptDoneCard } from './studioPromptDoneCard'
import type { StudioAppliedTip } from './agentStudioModes'
import type { LineDiffOp } from './lineDiffLcs'

const KEY = 'prompt-engineer-agent-draft-v1'
const KEY_V2 = 'prompt-engineer-agent-draft-v2'

export type DraftChatMessage = {
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
    diffOps: LineDiffOp[]
  }
}

/** Legacy v1 shape in localStorage — migrated once into v2 on read. */
type LegacyAgentDraftV1 = {
  v: 1
  savedAt: number
  chatMessages: DraftChatMessage[]
  baseTaskRef: string
  taskInput: string
  feedback: string
  result: GenerateResult | null
  sessionId: string | null
  iterationMode: boolean
  questionState: Record<number, { options: string[]; custom: string }>
  questionCarouselIdx: number
  quickSaved: boolean
  imagePresetId?: string
  imageEngine?: string
  imageDeepMode?: boolean
  skillPresetId?: string
}

export type AgentDraftV2 = {
  v: 2
  savedAt: number
  activePromptType: PromptStudioMode
  modes: Record<PromptStudioMode, AgentStudioSnapshot>
}

function v1ToSnapshot(d: LegacyAgentDraftV1): AgentStudioSnapshot {
  return {
    chatMessages: d.chatMessages as AgentStudioSnapshot['chatMessages'],
    baseTaskRef: d.baseTaskRef,
    taskInput: d.taskInput,
    feedback: d.feedback,
    result: d.result,
    sessionId: d.sessionId,
    iterationMode: d.iterationMode,
    questionState: d.questionState,
    questionCarouselIdx: d.questionCarouselIdx,
    quickSaved: d.quickSaved,
    imagePromptTags: [],
    imagePresetId: d.imagePresetId ?? '',
    imageEngine: d.imageEngine ?? 'auto',
    imageDeepMode: d.imageDeepMode ?? false,
    skillPresetId: d.skillPresetId ?? '',
    skillTargetEnv: 'generic',
    skillBody: '',
    expertLevel: 'mid',
    suggestedActions: [],
  }
}

export function loadAgentDraftV2(): AgentDraftV2 | null {
  try {
    const raw = localStorage.getItem(KEY_V2)
    if (raw) {
      const o = JSON.parse(raw) as AgentDraftV2
      if (o?.v === 2 && o.modes?.text && o.modes?.image && o.modes?.skill) {
        for (const m of ['text', 'image', 'skill'] as const) {
          const snap = o.modes[m]
          if (snap && typeof snap.skillBody !== 'string') {
            snap.skillBody = ''
          }
          if (snap && typeof snap.skillTargetEnv !== 'string') {
            snap.skillTargetEnv = 'generic'
          }
          if (snap && !snap.expertLevel) {
            snap.expertLevel = 'mid'
          }
          if (snap && !Array.isArray(snap.suggestedActions)) {
            snap.suggestedActions = []
          }
        }
        return o
      }
    }
    const raw1 = localStorage.getItem(KEY)
    if (raw1) {
      const d = JSON.parse(raw1) as LegacyAgentDraftV1
      if (d?.v === 1 && Array.isArray(d.chatMessages)) {
        const snap = v1ToSnapshot(d)
        const empty = (m: PromptStudioMode) => createEmptyStudioSnapshot(m)
        return {
          v: 2,
          savedAt: d.savedAt ?? Date.now(),
          activePromptType: 'text',
          modes: {
            text: snap,
            image: empty('image'),
            skill: empty('skill'),
          },
        }
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

export function saveAgentDraftV2(draft: Omit<AgentDraftV2, 'v' | 'savedAt'> & { savedAt?: number }): void {
  try {
    const payload: AgentDraftV2 = {
      v: 2,
      savedAt: draft.savedAt ?? Date.now(),
      activePromptType: draft.activePromptType,
      modes: draft.modes,
    }
    localStorage.setItem(KEY_V2, JSON.stringify(payload))
  } catch {
    /* quota */
  }
}

export function clearAgentDraftV2(): void {
  try {
    localStorage.removeItem(KEY_V2)
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
