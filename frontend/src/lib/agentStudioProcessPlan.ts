/**
 * Студия: основной путь маршрутизации — POST /agent/process (core/agent_followup_rules.py).
 * При ошибке сети / таймауте — resolveAgentFollowUpPlan (клиентский гибрид).
 */
import { api, normalizeSuggestedStudioActions, type SuggestedStudioAction } from '../api/client'
import type { FollowUpPlan } from './agentFollowUp'
import { resolveAgentFollowUpPlan } from './agentPlanResolver'

const AGENT_PROCESS_TIMEOUT_MS = 15_000
const CHAT_HISTORY_MAX_MESSAGES = 10
const CHAT_HISTORY_MAX_CHARS = 800

type ChatLike = { role: 'user' | 'assistant'; content: string }

export function buildAgentChatHistory(messages: ChatLike[]): { role: 'user' | 'assistant'; content: string }[] {
  return messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-CHAT_HISTORY_MAX_MESSAGES)
    .map((m) => ({
      role: m.role,
      content:
        m.content.length > CHAT_HISTORY_MAX_CHARS ? `${m.content.slice(0, CHAT_HISTORY_MAX_CHARS)}…` : m.content,
    }))
}

export function agentProcessResponseToPlan(res: AgentProcessResponse): FollowUpPlan {
  const d = res.data || {}
  const dbg = res.reasoning || ''
  switch (res.action) {
    case 'iterate':
      return { type: 'iterate', debug: dbg }
    case 'chat':
      return { type: 'chat', text: String(d.message ?? ''), debug: dbg }
    case 'save_library': {
      const tags = Array.isArray(d.tags) ? (d.tags as unknown[]).filter((x): x is string => typeof x === 'string') : []
      const titleHint = typeof d.title_hint === 'string' ? d.title_hint : undefined
      return { type: 'save_library', tags, titleHint, debug: dbg }
    }
    case 'eval_prompt':
      return { type: 'eval_prompt', debug: dbg }
    case 'evaluate':
      return { type: 'eval_prompt', debug: dbg }
    case 'show_versions':
      return { type: 'show_versions', debug: dbg }
    case 'nav_compare':
      return { type: 'nav_compare', debug: dbg }
    case 'nav_library':
      return {
        type: 'nav_library',
        search: typeof d.search === 'string' ? d.search : undefined,
        debug: dbg,
      }
    case 'nav_skills':
      return { type: 'nav_skills', debug: dbg }
    default:
      return { type: 'iterate', debug: `agent_process_unknown_action:${res.action} ${dbg}` }
  }
}

export async function resolveStudioFollowUpPlan(
  text: string,
  ctx: {
    sessionId: string | null
    promptType: string
    currentPrompt: string | undefined
    chatMessages: ChatLike[]
  },
): Promise<{ plan: FollowUpPlan; suggestedActions?: SuggestedStudioAction[] }> {
  try {
    const ac = new AbortController()
    const tid = window.setTimeout(() => ac.abort(), AGENT_PROCESS_TIMEOUT_MS)
    try {
      const res = await api.agentProcess(
        {
          text,
          session_id: ctx.sessionId,
          has_prompt: true,
          prompt_type: ctx.promptType,
          current_prompt: ctx.currentPrompt,
          chat_history: buildAgentChatHistory(ctx.chatMessages),
        },
        { signal: ac.signal },
      )
      const suggestedActions = normalizeSuggestedStudioActions(res.suggested_actions)
      return {
        plan: agentProcessResponseToPlan(res),
        suggestedActions: suggestedActions.length ? suggestedActions : undefined,
      }
    } finally {
      window.clearTimeout(tid)
    }
  } catch {
    return { plan: resolveAgentFollowUpPlan(text) }
  }
}
