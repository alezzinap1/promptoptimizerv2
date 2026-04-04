import type { GenerateResult } from '../api/client'
import type { AgentStudioSnapshot, PromptStudioMode } from './agentStudioModes'
import { createEmptyStudioSnapshot } from './agentStudioModes'

const KEY = 'prompt-engineer-agent-draft-v1'
const KEY_V2 = 'prompt-engineer-agent-draft-v2'

export type DraftChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  clarificationQA?: { question: string; answers: string[] }[]
}

/** @deprecated используйте AgentDraftV2 */
export type AgentDraftV1 = {
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

function v1ToSnapshot(d: AgentDraftV1): AgentStudioSnapshot {
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
  }
}

export function loadAgentDraftV2(): AgentDraftV2 | null {
  try {
    const raw = localStorage.getItem(KEY_V2)
    if (raw) {
      const o = JSON.parse(raw) as AgentDraftV2
      if (o?.v === 2 && o.modes?.text && o.modes?.image && o.modes?.skill) {
        return o
      }
    }
    const raw1 = localStorage.getItem(KEY)
    if (raw1) {
      const d = JSON.parse(raw1) as AgentDraftV1
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

/** Совместимость: старый API для вызовов без режимов */
export function loadAgentDraft(): AgentDraftV1 | null {
  const v2 = loadAgentDraftV2()
  if (!v2) return null
  const m = v2.modes[v2.activePromptType]
  return {
    v: 1,
    savedAt: v2.savedAt,
    chatMessages: m.chatMessages,
    baseTaskRef: m.baseTaskRef,
    taskInput: m.taskInput,
    feedback: m.feedback,
    result: m.result,
    sessionId: m.sessionId,
    iterationMode: m.iterationMode,
    questionState: m.questionState,
    questionCarouselIdx: m.questionCarouselIdx,
    quickSaved: m.quickSaved,
    imagePresetId: m.imagePresetId,
    imageEngine: m.imageEngine,
    imageDeepMode: m.imageDeepMode,
    skillPresetId: m.skillPresetId,
  }
}

export function saveAgentDraft(
  draft: Omit<AgentDraftV1, 'v' | 'savedAt'> & { savedAt?: number; activePromptType?: PromptStudioMode; allModes?: Record<PromptStudioMode, AgentStudioSnapshot> },
): void {
  if (draft.allModes && draft.activePromptType) {
    saveAgentDraftV2({
      activePromptType: draft.activePromptType,
      modes: draft.allModes,
      savedAt: draft.savedAt,
    })
    return
  }
  try {
    const payload: AgentDraftV1 = {
      v: 1,
      savedAt: draft.savedAt ?? Date.now(),
      chatMessages: draft.chatMessages,
      baseTaskRef: draft.baseTaskRef,
      taskInput: draft.taskInput,
      feedback: draft.feedback,
      result: draft.result,
      sessionId: draft.sessionId,
      iterationMode: draft.iterationMode,
      questionState: draft.questionState,
      questionCarouselIdx: draft.questionCarouselIdx,
      quickSaved: draft.quickSaved,
      imagePresetId: draft.imagePresetId,
      imageEngine: draft.imageEngine,
      imageDeepMode: draft.imageDeepMode,
      skillPresetId: draft.skillPresetId,
    }
    localStorage.setItem(KEY, JSON.stringify(payload))
  } catch {
    /* quota */
  }
}

export function clearAgentDraft(): void {
  clearAgentDraftV2()
}
