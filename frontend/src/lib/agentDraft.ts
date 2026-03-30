import type { GenerateResult } from '../api/client'

const KEY = 'prompt-engineer-agent-draft-v1'

export type DraftChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  clarificationQA?: { question: string; answers: string[] }[]
}

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
}

export function loadAgentDraft(): AgentDraftV1 | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as AgentDraftV1
    if (o?.v !== 1 || !Array.isArray(o.chatMessages)) return null
    return o
  } catch {
    return null
  }
}

export function saveAgentDraft(draft: Omit<AgentDraftV1, 'v' | 'savedAt'> & { savedAt?: number }): void {
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
    }
    localStorage.setItem(KEY, JSON.stringify(payload))
  } catch {
    /* quota / private mode */
  }
}

export function clearAgentDraft(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
