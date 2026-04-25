import type { GenerateResult } from '../api/client'
import { computeLineDiffOps } from './lineDiffLcs'

export type PromptDoneDiffRow = { kind: 'add' | 'rm' | 'chg'; text: string }

/** Полный текст совета для итерации; в UI показывается как «Совет N». */
export type PromptDoneSuggestion = { fullText: string }

export type SkillTestCaseItem = { user: string; expect_substring: string }

export type PromptDoneCard = {
  version: number
  completeness: number
  techniquesLabel: string
  tokenEstimate: number
  promptSnapshot: string
  /** Текст до итерации — для полного diff в чате (кнопка «Полный diff»). */
  iterationDiffBase?: string
  suggestions: PromptDoneSuggestion[]
  diff?: {
    fromVersion: number
    toVersion: number
    rows: PromptDoneDiffRow[]
  }
  skillTestCases?: SkillTestCaseItem[]
}

const FALLBACK_SUGGESTIONS = ['Сделать короче', 'Добавить примеры', 'Ужесточить ограничения']

function lineWord(n: number): string {
  const m = n % 10
  const m100 = n % 100
  if (m100 >= 11 && m100 <= 14) return 'строк'
  if (m === 1) return 'строка'
  if (m >= 2 && m <= 4) return 'строки'
  return 'строк'
}

/** Короткие подписи техник для чипа (как в макете «Role + CoT»). */
export function shortTechniquesLabel(techniques?: { id: string; name: string }[]): string {
  if (!techniques?.length) return '—'
  return techniques
    .slice(0, 2)
    .map((t) => {
      const n = (t.name || t.id || '').trim()
      if (!n) return t.id
      const w = n.split(/\s+/).filter(Boolean)
      if (w.length <= 1) return w[0]!.slice(0, 12)
      return `${w[0]!.slice(0, 10)} + ${w[1]!.slice(0, 8)}`
    })
    .join(' + ')
}

/** 2–3 подсказки полным текстом (для чипов «Совет N» и отправки в итерацию). */
export function pickSuggestionChips(res: GenerateResult): PromptDoneSuggestion[] {
  const tips = (res.metrics?.improvement_tips as string[] | undefined)?.map((t) => t.trim()).filter(Boolean) ?? []
  const out: PromptDoneSuggestion[] = []
  const seen = new Set<string>()
  for (const t of tips) {
    if (out.length >= 3) break
    if (!seen.has(t)) {
      seen.add(t)
      out.push({ fullText: t })
    }
  }
  for (const f of FALLBACK_SUGGESTIONS) {
    if (out.length >= 3) break
    if (!seen.has(f)) {
      seen.add(f)
      out.push({ fullText: f })
    }
  }
  return out.slice(0, 3)
}

function normalizeSkillTestCases(res: GenerateResult): SkillTestCaseItem[] {
  const raw = res.test_cases
  if (!Array.isArray(raw)) return []
  const out: SkillTestCaseItem[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const u = typeof o.user === 'string' ? o.user.trim() : ''
    const exp =
      typeof o.expect_substring === 'string'
        ? o.expect_substring.trim()
        : typeof o.must_contain === 'string'
          ? o.must_contain.trim()
          : ''
    if (u && exp) out.push({ user: u, expect_substring: exp })
  }
  return out.slice(0, 12)
}

export function buildIterationDiffSummary(
  prevPrompt: string,
  nextPrompt: string,
  _fromVersion: number,
  _toVersion: number,
  prevScore: number,
  nextScore: number,
  prevTokens: number,
  nextTokens: number,
): { rows: PromptDoneDiffRow[] } {
  const ops = computeLineDiffOps(prevPrompt, nextPrompt)
  const delN = ops.filter((o) => o.kind === 'del').length
  const insN = ops.filter((o) => o.kind === 'ins').length
  const rows: PromptDoneDiffRow[] = []

  if (delN > 0) {
    rows.push({ kind: 'rm', text: `Убрано ${delN} ${lineWord(delN)}` })
  }
  if (insN > 0) {
    rows.push({ kind: 'add', text: `Добавлено ${insN} ${lineWord(insN)}` })
  }
  if (delN === 0 && insN === 0 && prevPrompt !== nextPrompt) {
    rows.push({ kind: 'chg', text: 'Текст отредактирован' })
  }

  if (prevScore > 0 && nextScore > 0 && Math.round(prevScore) !== Math.round(nextScore)) {
    rows.push({
      kind: 'chg',
      text: `Полнота: ${Math.round(prevScore)}% → ${Math.round(nextScore)}%`,
    })
  }

  if (prevTokens > 0 && nextTokens > 0) {
    const d = nextTokens - prevTokens
    const sign = d > 0 ? '+' : ''
    rows.push({
      kind: 'chg',
      text: `Токены ≈${prevTokens.toLocaleString('ru-RU')} → ≈${nextTokens.toLocaleString('ru-RU')} (${sign}${d.toLocaleString('ru-RU')})`,
    })
  }

  return { rows: rows.slice(0, 6) }
}

export function buildPromptDoneCard(
  res: GenerateResult,
  ctx: {
    nextVersion: number
    isIteration: boolean
    previousPromptBlock?: string
    fromVersion?: number
    prevScore?: number
    prevTokens?: number
  },
): PromptDoneCard {
  const completeness = Math.round(
    Number(res.metrics?.completeness_score ?? res.metrics?.quality_score ?? 0),
  )
  const tokenEstimate = Math.round(Number(res.metrics?.token_estimate ?? 0))
  const techniquesLabel = shortTechniquesLabel(res.techniques)
  const suggestions = pickSuggestionChips(res)
  const promptSnapshot = res.prompt_block || ''
  const skillCases = normalizeSkillTestCases(res)
  const skillTestCases =
    res.prompt_type === 'skill' && skillCases.length > 0 ? skillCases : undefined

  let diff: PromptDoneCard['diff'] | undefined
  if (
    ctx.isIteration &&
    ctx.previousPromptBlock &&
    ctx.fromVersion !== undefined &&
    ctx.fromVersion >= 1
  ) {
    const { rows } = buildIterationDiffSummary(
      ctx.previousPromptBlock,
      promptSnapshot,
      ctx.fromVersion,
      ctx.nextVersion,
      ctx.prevScore ?? 0,
      completeness,
      ctx.prevTokens ?? 0,
      tokenEstimate,
    )
    if (rows.length > 0) {
      diff = { fromVersion: ctx.fromVersion, toVersion: ctx.nextVersion, rows }
    }
  }

  return {
    version: ctx.nextVersion,
    completeness,
    techniquesLabel,
    tokenEstimate,
    promptSnapshot,
    iterationDiffBase:
      ctx.isIteration && ctx.previousPromptBlock?.trim() ? ctx.previousPromptBlock : undefined,
    suggestions,
    diff,
    skillTestCases,
  }
}
