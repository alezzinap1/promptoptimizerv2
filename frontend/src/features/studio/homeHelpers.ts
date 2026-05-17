import type { GenerateResult, StructuredQuestion } from '../../api/client'
import type { StudioAppliedTip } from '../../lib/agentStudioModes'
import { computeRefinedLineDiffOps } from '../../lib/lineDiffLcs'
import { suggestLibraryTitle } from '../../lib/libraryTitle'
import { buildPromptDoneCard } from '../../lib/studioPromptDoneCard'
import type { PromptDoneCard } from '../../lib/studioPromptDoneCard'

export type StudioGenChatMsg = {
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
    diffOps: ReturnType<typeof computeRefinedLineDiffOps>
  }
}

export type StudioChatMessage = StudioGenChatMsg & {
  routerClarification?: { reason?: string; routerLogId?: number; pendingUserText: string }
}

export type DoneGenerationContext = {
  nextVersion: number
  isIteration: boolean
  previousPromptBlock?: string
  fromVersion?: number
  prevScore: number
  prevTokens: number
}

export type StudioTechnique = { id: string; name: string }

/**
 * При первичной генерации: [PROMPT]+хвост [QUESTIONS] без парсинга вопросов во второй фазе ломает мастер уточнений — чистим.
 * При итерации сервер оставляет structured questions для сообщения в чате; тогда has_questions всё равно false (мастер не открываем).
 */
export function normalizeClientGenerateResult(
  res: GenerateResult,
  opts?: { keepIterationCompanionQuestions?: boolean },
): GenerateResult {
  if (!res.has_prompt) return res
  if (opts?.keepIterationCompanionQuestions && (res.questions?.length ?? 0) > 0) {
    return { ...res, has_questions: false }
  }
  return { ...res, has_questions: false, questions: [] }
}

export function formatCompanionQuestionsForChat(questions: StructuredQuestion[]): string {
  const lines: string[] = [
    '**Уточнения по идеям** (ответьте в чате — дальше можно снова нажать «Креативнее» или описать выбор словами):',
    '',
  ]
  questions.forEach((q, i) => {
    lines.push(`${i + 1}. ${q.question}`)
    for (const opt of q.options || []) {
      lines.push(`   - ${opt}`)
    }
    lines.push('')
  })
  return lines.join('\n').trimEnd()
}

/** Строка из prompt_sessions → обновить result справа (полнота, токены, техники совпадают с версией). */
export function mergeSessionVersionIntoResult(
  prev: GenerateResult | null,
  row: Record<string, unknown>,
  sessionId: string,
): GenerateResult {
  const techniqueIds = (Array.isArray(row.techniques_used) ? row.techniques_used : []) as string[]
  const rawM = row.metrics
  const rowMetrics =
    typeof rawM === 'object' && rawM !== null ? (rawM as Record<string, unknown>) : null
  const metrics =
    rowMetrics && Object.keys(rowMetrics).length > 0 ? rowMetrics : (prev?.metrics ?? {})

  const base: GenerateResult =
    prev ??
    ({
      prompt_block: '',
      reasoning: '',
      has_prompt: true,
      has_questions: false,
      techniques: [],
      technique_ids: [],
      task_types: [],
      complexity: 'medium',
      gen_model: '',
      target_model: 'unknown',
      metrics: {},
      session_id: sessionId,
    } as GenerateResult)

  return {
    ...base,
    prompt_block: String(row.final_prompt || base.prompt_block),
    reasoning: String(row.reasoning ?? base.reasoning),
    has_prompt: true,
    has_questions: false,
    techniques: techniqueIds.map((id) => ({ id, name: id })),
    technique_ids: techniqueIds,
    task_types: (Array.isArray(row.task_types) ? row.task_types : base.task_types) as string[],
    complexity: String(row.complexity || base.complexity),
    gen_model: String(row.gen_model || base.gen_model),
    target_model: String(row.target_model || base.target_model),
    metrics,
    session_id: sessionId || base.session_id,
  }
}

export function pickPromptTitle(res: GenerateResult | null, taskFallback: string): string {
  const m = res?.metrics?.prompt_title
  if (typeof m === 'string' && m.trim()) return m.trim()
  if (res?.prompt_title?.trim()) return res.prompt_title.trim()
  return suggestLibraryTitle(taskFallback)
}

export function mergeStudioSkillTags(raw: string): string[] {
  const tags = raw.split(',').map((t) => t.trim()).filter(Boolean)
  const lower = new Set(tags.map((t) => t.toLowerCase()))
  if (!lower.has('скилл') && !lower.has('skill') && !lower.has('студия')) {
    tags.push('студия')
  }
  return tags
}

export function buildDoneGenerationContext(
  prevMsgs: StudioGenChatMsg[],
  versions: Record<string, unknown>[],
  isIteration: boolean,
  previousPrompt: string | undefined,
  prevResult: GenerateResult | null,
): DoneGenerationContext {
  const maxVer =
    versions.length > 0
      ? Math.max(...versions.map((v) => Number((v as Record<string, unknown>).version) || 0))
      : 0
  const maxFromChat = prevMsgs.reduce((acc, m) => Math.max(acc, m.promptDoneCard?.version ?? 0), 0)
  const base = Math.max(maxVer, maxFromChat)
  const nextVersion = base + 1
  const hasPrev = Boolean(isIteration && previousPrompt && previousPrompt.trim())
  return {
    nextVersion,
    isIteration: hasPrev,
    previousPromptBlock: hasPrev ? String(previousPrompt) : undefined,
    fromVersion: hasPrev ? base : undefined,
    prevScore: prevResult ? Number(prevResult.metrics?.completeness_score ?? prevResult.metrics?.quality_score ?? 0) : 0,
    prevTokens: prevResult ? Math.round(Number(prevResult.metrics?.token_estimate ?? 0)) : 0,
  }
}

export function findPendingClarificationId(messages: StudioGenChatMsg[]): string | null {
  const m = [...messages].reverse().find(
    (x) =>
      x.role === 'assistant' &&
      x.content.includes('Нужны уточнения') &&
      x.clarificationQA === undefined,
  )
  return m?.id ?? null
}

/** Сообщения чата после ответа генерации (без учёта смены вкладки). */
export function computeChatAfterGeneration(
  prev: StudioGenChatMsg[],
  res: GenerateResult,
  questionAnswers: { question: string; answers: string[] }[] | undefined,
  doneCtx: DoneGenerationContext,
): { next: StudioGenChatMsg[]; lastClarificationsMsgId: string | null } {
  let next: StudioGenChatMsg[] = [...prev]
  let lastClarificationsMsgId: string | null = null
  const pendingId = findPendingClarificationId(prev)
  if (questionAnswers !== undefined && pendingId) {
    next = next.map((m) => (m.id === pendingId ? { ...m, clarificationQA: questionAnswers } : m))
  }
  if (res.has_prompt) {
    const thinkingParts: string[] = []
    if (res.techniques?.length) {
      thinkingParts.push(`**Техники:** ${res.techniques.map((t) => t.name).join(', ')}`)
    }
    if (res.technique_reasons?.length) {
      thinkingParts.push(
        res.technique_reasons
          .map((tr) => `• **${tr.id}:** ${tr.reason.length > 200 ? `${tr.reason.slice(0, 200)}…` : tr.reason}`)
          .join('\n'),
      )
    }
    if (res.reasoning) {
      const short = res.reasoning.length > 400 ? res.reasoning.slice(0, 400) + '…' : res.reasoning
      thinkingParts.push(short)
    }
    if (thinkingParts.length > 0) {
      next.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `__thinking__\n${thinkingParts.join('\n\n')}`,
      })
    }
    next.push({
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      promptDoneCard: buildPromptDoneCard(res, {
        nextVersion: doneCtx.nextVersion,
        isIteration: doneCtx.isIteration,
        previousPromptBlock: doneCtx.previousPromptBlock,
        fromVersion: doneCtx.fromVersion,
        prevScore: doneCtx.prevScore,
        prevTokens: doneCtx.prevTokens,
      }),
    })
    if ((res.questions?.length ?? 0) > 0) {
      next.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: formatCompanionQuestionsForChat(res.questions!),
      })
    }
  } else if (res.has_questions && (res.questions?.length || 0) > 0) {
    const cid = crypto.randomUUID()
    lastClarificationsMsgId = cid
    next.push({
      id: cid,
      role: 'assistant',
      content:
        'Нужны уточнения: панель под чатом, листайте вопросы — на последнем шаге нажмите «Подтвердить».',
    })
  }
  return { next, lastClarificationsMsgId }
}
