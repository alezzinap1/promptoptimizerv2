/**
 * Persist agent-mode chat per server session id so «Сессии» in the sidebar
 * can restore the left column when reopening a session.
 */
import type { DraftChatMessage } from './agentDraft'
import type { PromptDoneCard, PromptDoneDiffRow } from './studioPromptDoneCard'
import type { StudioAppliedTip } from './agentStudioModes'
import type { LineDiffOp } from './lineDiffLcs'

const PREFIX = 'prompt-engineer-session-chat:'

export type SessionChatMessage = DraftChatMessage

function parseDiffRows(raw: unknown): PromptDoneDiffRow[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const rows: PromptDoneDiffRow[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const kind = o.kind
    const text = typeof o.text === 'string' ? o.text : ''
    if (kind !== 'add' && kind !== 'rm' && kind !== 'chg') continue
    if (!text.trim()) continue
    rows.push({ kind, text })
  }
  return rows.length ? rows : undefined
}

function parsePromptDoneCard(raw: unknown): PromptDoneCard | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const version = Number(o.version)
  if (!Number.isFinite(version) || version < 1) return undefined
  const completeness = Math.round(Number(o.completeness) || 0)
  const techniquesLabel = typeof o.techniquesLabel === 'string' ? o.techniquesLabel : '—'
  const tokenEstimate = Math.round(Number(o.tokenEstimate) || 0)
  const promptSnapshot = typeof o.promptSnapshot === 'string' ? o.promptSnapshot : ''
  const iterationDiffBaseRaw = o.iterationDiffBase
  const iterationDiffBase =
    typeof iterationDiffBaseRaw === 'string' && iterationDiffBaseRaw.length > 0
      ? iterationDiffBaseRaw
      : undefined
  const suggestions: PromptDoneCard['suggestions'] = []
  if (Array.isArray(o.suggestions)) {
    for (const x of o.suggestions) {
      if (typeof x === 'string' && x.trim()) {
        suggestions.push({ fullText: x.trim() })
      } else if (x && typeof x === 'object') {
        const ft = (x as Record<string, unknown>).fullText
        if (typeof ft === 'string' && ft.trim()) suggestions.push({ fullText: ft.trim() })
      }
      if (suggestions.length >= 5) break
    }
  }
  let diff: PromptDoneCard['diff']
  const d = o.diff
  if (d && typeof d === 'object') {
    const dr = d as Record<string, unknown>
    const fromVersion = Number(dr.fromVersion)
    const toVersion = Number(dr.toVersion)
    const rows = parseDiffRows(dr.rows)
    if (Number.isFinite(fromVersion) && Number.isFinite(toVersion) && rows?.length) {
      diff = { fromVersion, toVersion, rows }
    }
  }
  let skillTestCases: PromptDoneCard['skillTestCases']
  const stc = o.skillTestCases
  if (Array.isArray(stc)) {
    const rows: NonNullable<PromptDoneCard['skillTestCases']> = []
    for (const x of stc) {
      if (!x || typeof x !== 'object') continue
      const t = x as Record<string, unknown>
      const u = typeof t.user === 'string' ? t.user.trim() : ''
      const exp =
        typeof t.expect_substring === 'string'
          ? t.expect_substring.trim()
          : typeof t.must_contain === 'string'
            ? t.must_contain.trim()
            : ''
      if (u && exp) rows.push({ user: u, expect_substring: exp })
    }
    if (rows.length) skillTestCases = rows
  }
  return {
    version,
    completeness,
    techniquesLabel,
    tokenEstimate,
    promptSnapshot,
    iterationDiffBase,
    suggestions,
    diff,
    skillTestCases,
  }
}

function parseEditPreviewCard(raw: unknown):
  | {
      instruction: string
      oldPrompt: string
      newPrompt: string
      diffOps: LineDiffOp[]
    }
  | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const instruction = typeof o.instruction === 'string' ? o.instruction : ''
  const oldPrompt = typeof o.oldPrompt === 'string' ? o.oldPrompt : ''
  const newPrompt = typeof o.newPrompt === 'string' ? o.newPrompt : ''
  if (!instruction.trim() || !oldPrompt || !newPrompt) return undefined
  const diffOps: LineDiffOp[] = []
  if (Array.isArray(o.diffOps)) {
    for (const row of o.diffOps) {
      if (!row || typeof row !== 'object') continue
      const r = row as Record<string, unknown>
      const kind = r.kind
      const text = typeof r.text === 'string' ? r.text : ''
      if (kind !== 'eq' && kind !== 'del' && kind !== 'ins') continue
      diffOps.push({ kind, text })
    }
  }
  return { instruction, oldPrompt, newPrompt, diffOps }
}

function parseAppliedTip(raw: unknown): StudioAppliedTip | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const t = raw as Record<string, unknown>
  const index = Number(t.index)
  const fullText = typeof t.fullText === 'string' ? t.fullText : ''
  if (!Number.isFinite(index) || index < 1 || !fullText.trim()) return undefined
  return { index, fullText }
}

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
        promptDoneCard: parsePromptDoneCard(o.promptDoneCard),
        appliedTip: parseAppliedTip(o.appliedTip),
        editPreviewCard: parseEditPreviewCard(o.editPreviewCard),
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
