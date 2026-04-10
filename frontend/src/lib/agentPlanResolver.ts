/**
 * Fallback для студии при сбое POST /agent/process (сеть, таймаут).
 * Основной путь: resolveStudioFollowUpPlan в agentStudioProcessPlan.ts.
 *
 * Гибрид: семантический роутер (fastembed на сервере) + rule-based fallback.
 * Явные глаголы правки всегда переводят в iterate.
 */
import { api } from '../api/client'
import {
  AGENT_PRODUCT_HELP_TEXT,
  classifyAgentFollowUp,
  looksLikeApplyTipDirective,
  looksLikeStrongEdit,
  parseTagsFromText,
  parseTitleHint,
  type FollowUpPlan,
} from './agentFollowUp'

const SEMANTIC_INTENTS = new Set([
  'iterate',
  'chat',
  'save_library',
  'eval_prompt',
  'show_versions',
  'nav_compare',
  'nav_library',
  'nav_skills',
])

function parseLibrarySearchFromText(raw: string): string | undefined {
  const m = raw.match(/по\s+(?:запросу|искомому|тексту)\s+["«']([^"»']+)["»']/i)
  return m?.[1]?.trim()
}

function planFromSemanticIntent(
  intent: string,
  userText: string,
  meta: { confidence: number; margin: number; backend: string },
): FollowUpPlan | null {
  if (!SEMANTIC_INTENTS.has(intent)) return null
  const dbg = `semantic ${intent} conf=${meta.confidence} margin=${meta.margin} ${meta.backend}`
  const raw = userText.replace(/\s+/g, ' ').trim()

  switch (intent) {
    case 'iterate':
      return { type: 'iterate', debug: dbg }
    case 'chat':
      return { type: 'chat', text: AGENT_PRODUCT_HELP_TEXT, debug: dbg }
    case 'save_library':
      return {
        type: 'save_library',
        tags: parseTagsFromText(raw),
        titleHint: parseTitleHint(raw),
        debug: dbg,
      }
    case 'eval_prompt':
      return { type: 'eval_prompt', debug: dbg }
    case 'show_versions':
      return { type: 'show_versions', debug: dbg }
    case 'nav_compare':
      return { type: 'nav_compare', debug: dbg }
    case 'nav_library':
      return { type: 'nav_library', search: parseLibrarySearchFromText(raw), debug: dbg }
    case 'nav_skills':
      return { type: 'nav_skills', debug: dbg }
    default:
      return null
  }
}

export async function resolveAgentFollowUpPlan(userText: string): Promise<FollowUpPlan> {
  const rules = classifyAgentFollowUp(userText)
  if (looksLikeApplyTipDirective(userText)) {
    return { type: 'iterate', debug: 'apply_tip_directive' }
  }
  if (looksLikeStrongEdit(userText)) {
    return { type: 'iterate', debug: 'override_strong_edit' }
  }

  try {
    const r = await api.semanticAgentRoute({ text: userText, has_prompt: true })
    if (r.intent && r.backend === 'semantic') {
      const p = planFromSemanticIntent(r.intent, userText, {
        confidence: r.confidence,
        margin: r.margin,
        backend: r.backend,
      })
      if (p) {
        if (p.type === 'chat' && looksLikeApplyTipDirective(userText)) {
          return {
            type: 'iterate',
            debug: `semantic_chat_overridden_apply_tip conf=${r.confidence} margin=${r.margin}`,
          }
        }
        return p
      }
    }
  } catch {
    /* сеть / 404 / роутер отключён */
  }

  return rules
}
