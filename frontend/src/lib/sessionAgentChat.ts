/**
 * Persist agent-mode chat per server session id so «Сессии» in the sidebar
 * can restore the left column when reopening a session.
 */
import type { DraftChatMessage } from './agentDraft'

const PREFIX = 'prompt-engineer-session-chat:'

export type SessionChatMessage = DraftChatMessage

export function saveSessionAgentChat(sessionId: string, messages: SessionChatMessage[]): void {
  if (!sessionId?.trim()) return
  try {
    const key = PREFIX + sessionId
    localStorage.setItem(key, JSON.stringify(messages))
  } catch {
    /* quota */
  }
}

export function loadSessionAgentChat(sessionId: string): SessionChatMessage[] | null {
  if (!sessionId?.trim()) return null
  try {
    const raw = localStorage.getItem(PREFIX + sessionId)
    if (!raw) return null
    const p = JSON.parse(raw) as unknown
    if (!Array.isArray(p) || p.length === 0) return null
    const out: SessionChatMessage[] = []
    for (const m of p) {
      if (!m || typeof m !== 'object') continue
      const o = m as Record<string, unknown>
      if (o.role !== 'user' && o.role !== 'assistant') continue
      if (typeof o.content !== 'string') continue
      out.push({
        id: typeof o.id === 'string' ? o.id : crypto.randomUUID(),
        role: o.role,
        content: o.content,
        clarificationQA: Array.isArray(o.clarificationQA) ? (o.clarificationQA as SessionChatMessage['clarificationQA']) : undefined,
      })
    }
    return out.length ? out : null
  } catch {
    return null
  }
}

export function clearSessionAgentChat(sessionId: string): void {
  try {
    localStorage.removeItem(PREFIX + sessionId)
  } catch {
    /* ignore */
  }
}
