// Eval-Stability API client.
//
// Wraps the backend's `/api/eval/*` and `/api/library/{id}/eval-summary`
// endpoints. The SSE helper `subscribeEvalRunStream` is the only thing here
// that doesn't go through `fetch` — it uses a raw EventSource-like loop on
// fetch with a streaming body so we can pass the X-Session-Id header
// (browsers' native EventSource cannot set custom headers).

const API_BASE = '/api'
const AUTH_STORAGE_KEY = 'prompt-engineer-auth-session'

function getAuthSessionId(): string | null {
  try {
    return window.localStorage.getItem(AUTH_STORAGE_KEY)
  } catch {
    return null
  }
}

export interface EvalRubricCriterion {
  key: string
  weight: number
  description: string
  anchors: Record<string, string>
}

export interface EvalRubricPreset {
  preset_key: string
  name: string
  description?: string
  reference_required: boolean
  criteria: EvalRubricCriterion[]
}

export interface EvalRubricCustom {
  id: number
  user_id: number
  name: string
  preset_key?: string | null
  reference_required: boolean
  criteria: EvalRubricCriterion[]
  created_at?: string
  updated_at?: string
}

export interface EvalRubricsResponse {
  presets: EvalRubricPreset[]
  custom: EvalRubricCustom[]
}

export interface EvalCostBreakdown {
  target: { input_tokens: number; output_tokens: number; usd: number }
  judge: { input_tokens: number; output_tokens: number; usd: number }
  synthesis: { input_tokens: number; output_tokens: number; usd: number }
  embedding: { input_tokens: number; usd: number }
  total_tokens: number
  total_usd: number
  pricing_status: 'exact' | 'approximate'
  daily_budget_usd: number
  daily_spent_usd: number
  daily_remaining_usd: number
  over_daily_budget: boolean
}

export interface EvalRunSummary {
  id: number
  user_id: number
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  mode: 'single' | 'pair'
  prompt_a_text: string
  prompt_b_text: string | null
  task_input: string
  reference_answer: string | null
  target_model_id: string
  judge_model_id: string
  embedding_model_id: string
  rubric_snapshot: { criteria: EvalRubricCriterion[]; name?: string; preset_key?: string | null; reference_required?: boolean }
  n_runs: number
  parallelism: number
  temperature: number
  top_p: number | null
  pair_judge_samples: number
  cost_preview_usd: number
  cost_preview_tokens: number
  cost_actual_usd: number | null
  cost_actual_tokens: number | null
  duration_ms: number | null
  diversity_score: number | null
  agg_overall_p50: number | null
  agg_overall_p10: number | null
  agg_overall_p90: number | null
  agg_overall_var: number | null
  pair_winner: 'A' | 'B' | 'tie' | null
  pair_winner_confidence: number | null
  judge_secondary_model_id?: string | null
  run_synthesis?: boolean
  synthesis_model_id?: string | null
  judge_agreement_mean_abs?: number | null
  meta_synthesis_mode?: 'full' | 'lite'
  synthesis_error?: string | null
  synthesis_report?: EvalSynthesisReport | null
  meta_pipeline?: EvalMetaPipeline | null
  prompt_fingerprint?: string | null
  task_fingerprint?: string | null
  rubric_fingerprint?: string | null
  prompt_a_library_id: number | null
  prompt_a_library_version: number | null
  prompt_b_library_id: number | null
  prompt_b_library_version: number | null
  created_at: string
  finished_at: string | null
  error: string | null
}

export interface EvalEvidenceSpan {
  result_id: number
  excerpt: string
  criterion_key?: string | null
}

export interface EvalSynthesisReport {
  meta_schema_version?: number
  summary?: string
  failure_modes?: Array<{
    pattern: string
    evidence: string
    severity: number
    hypothesis_id?: string
    evidence_spans?: EvalEvidenceSpan[]
  }>
  prompt_fixes?: string[]
  criteria_weak_spots?: Array<{ criterion_key: string; note: string; hypothesis_id?: string }>
}

export interface EvalMetaCluster {
  cluster_id?: number
  members?: Array<{ result_id?: number; run_index?: number; judge_primary?: number; excerpt?: string }>
}

export interface EvalVerifiedHypothesis {
  id?: string
  pattern?: string
  cluster_ids?: unknown[]
  evidence?: EvalEvidenceSpan[]
}

export interface EvalMetaPipeline {
  schema_version?: number
  clusters?: EvalMetaCluster[]
  hypotheses_raw?: unknown[]
  verified_hypotheses?: EvalVerifiedHypothesis[]
  synthesis_raw?: unknown
}

export interface EvalResultRow {
  id: number
  run_id: number
  prompt_side: 'A' | 'B'
  run_index: number
  output_text: string
  output_tokens: number
  input_tokens: number
  latency_ms: number | null
  status: 'ok' | 'error'
  error: string | null
  embedding: number[] | null
  judge_overall: number | null
  judge_overall_secondary?: number | null
  judge_reasoning: string | null
  judge_reasoning_secondary?: string | null
  parsed_as_json: boolean
  judge_scores?: Array<{ criterion_key: string; score: number; reasoning: string | null }>
}

export interface EvalRunDetail {
  run: EvalRunSummary
  results: EvalResultRow[]
}

export interface EvalLibrarySummary {
  runs: EvalRunSummary[]
  count: number
  last: EvalRunSummary | null
}

export interface EvalRunSeriesResponse {
  runs: EvalRunSummary[]
  fingerprints: {
    prompt_fingerprint: string
    task_fingerprint: string
    rubric_fingerprint: string
  } | null
  group_by_model: Record<string, EvalRunSummary[]> | null
}

export interface PreviewCostRequest {
  prompt_a_text: string
  prompt_b_text?: string | null
  task_input: string
  reference_answer?: string | null
  n_runs: number
  target_model_id: string
  judge_model_id?: string
  judge_secondary_model_id?: string | null
  embedding_model_id?: string
  synthesis_model_id?: string | null
  run_synthesis?: boolean
  expected_output_tokens?: number
  pair_judge_samples?: number
  /** full = multi-step meta pipeline; lite = one LLM synthesis call */
  meta_synthesis_mode?: 'full' | 'lite'
}

export interface CreateRunRequest extends PreviewCostRequest {
  temperature?: number
  top_p?: number | null
  parallelism?: number
  preset_key?: string | null
  rubric_id?: number | null
  prompt_a_library_id?: number | null
  prompt_a_library_version?: number | null
  prompt_b_library_id?: number | null
  prompt_b_library_version?: number | null
}

export interface CreateRunResponse {
  run_id: number
  status: string
  cost_preview_usd: number
  cost_preview_tokens: number
  mode: 'single' | 'pair'
}

// ─── HTTP helpers ──────────────────────────────────────────────────────────

class EvalApiError extends Error {
  status: number
  constructor(msg: string, status: number) {
    super(msg)
    this.status = status
  }
}

async function evalFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('Content-Type', 'application/json')
  const sid = getAuthSessionId()
  if (sid) headers.set('X-Session-Id', sid)
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers })
  const text = await res.text()
  if (!res.ok) {
    let msg = `${res.status}`
    try {
      const obj = JSON.parse(text)
      if (obj?.detail) msg = typeof obj.detail === 'string' ? obj.detail : JSON.stringify(obj.detail)
    } catch {
      msg = text || msg
    }
    throw new EvalApiError(msg, res.status)
  }
  return JSON.parse(text) as T
}

// ─── Rubrics CRUD ──────────────────────────────────────────────────────────

export const evalApi = {
  listRubrics: () => evalFetch<EvalRubricsResponse>('/eval/rubrics'),
  createRubric: (req: { name: string; criteria: EvalRubricCriterion[]; preset_key?: string | null; reference_required?: boolean }) =>
    evalFetch<{ id: number; ok: true }>('/eval/rubrics', { method: 'POST', body: JSON.stringify(req) }),
  updateRubric: (id: number, req: { name?: string; criteria?: EvalRubricCriterion[]; reference_required?: boolean }) =>
    evalFetch<{ ok: true }>(`/eval/rubrics/${id}`, { method: 'PATCH', body: JSON.stringify(req) }),
  deleteRubric: (id: number) =>
    evalFetch<{ ok: true }>(`/eval/rubrics/${id}`, { method: 'DELETE' }),

  previewCost: (req: PreviewCostRequest) =>
    evalFetch<EvalCostBreakdown>('/eval/stability/preview-cost', {
      method: 'POST',
      body: JSON.stringify(req),
    }),

  createRun: (req: CreateRunRequest) =>
    evalFetch<CreateRunResponse>('/eval/stability/runs', {
      method: 'POST',
      body: JSON.stringify(req),
    }),

  getRun: (id: number) => evalFetch<EvalRunDetail>(`/eval/stability/runs/${id}`),
  listRuns: (limit = 50) => evalFetch<{ runs: EvalRunSummary[] }>(`/eval/stability/runs?limit=${limit}`),
  listRunSeries: (params: {
    library_id?: number
    prompt_fingerprint?: string
    task_fingerprint?: string
    rubric_fingerprint?: string
    target_model_id?: string
    group_by_model?: boolean
    limit?: number
  }) => {
    const q = new URLSearchParams()
    if (params.library_id != null) q.set('library_id', String(params.library_id))
    if (params.prompt_fingerprint) q.set('prompt_fingerprint', params.prompt_fingerprint)
    if (params.task_fingerprint) q.set('task_fingerprint', params.task_fingerprint)
    if (params.rubric_fingerprint) q.set('rubric_fingerprint', params.rubric_fingerprint)
    if (params.target_model_id) q.set('target_model_id', params.target_model_id)
    if (params.group_by_model) q.set('group_by_model', 'true')
    if (params.limit != null) q.set('limit', String(params.limit))
    const qs = q.toString()
    return evalFetch<EvalRunSeriesResponse>(`/eval/stability/runs/series${qs ? `?${qs}` : ''}`)
  },
  cancelRun: (id: number) =>
    evalFetch<{ ok: boolean; requested?: boolean }>(`/eval/stability/runs/${id}/cancel`, { method: 'POST' }),
  deleteRun: (id: number) =>
    evalFetch<{ ok: true }>(`/eval/stability/runs/${id}`, { method: 'DELETE' }),

  getLibraryEvalSummary: (libraryId: number) =>
    evalFetch<EvalLibrarySummary>(`/library/${libraryId}/eval-summary`),
}

// ─── SSE stream ────────────────────────────────────────────────────────────

export type EvalStreamEvent =
  | { type: 'started'; run_id: number; n_runs: number; mode: string; target_model_id: string; judge_model_id: string }
  | { type: 'progress'; phase: 'generate' | 'judge' | 'judge_secondary' | 'embed' | 'pair_judge' | 'synthesis'; [k: string]: unknown }
  | { type: 'summary'; side_summaries: Record<string, { stats: { p10: number; p50: number; p90: number; var: number; mean: number }; diversity: number }>; pair: { winner: 'A' | 'B' | 'tie' | null; confidence: number } | null }
  | { type: 'done'; status: 'completed' | 'failed' | 'cancelled'; duration_ms?: number; error?: string }

export function parseEvalSse(chunk: string): { events: EvalStreamEvent[]; remaining: string } {
  // SSE messages are separated by a blank line ("\n\n"). Each block can have
  // one or more "field: value" lines. We only care about "data: <json>".
  const events: EvalStreamEvent[] = []
  const blocks = chunk.split('\n\n')
  // The last block may be incomplete — return it as "remaining".
  const complete = blocks.slice(0, -1)
  const remaining = blocks[blocks.length - 1] ?? ''
  for (const block of complete) {
    const dataLines = block
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
    if (!dataLines.length) continue
    const raw = dataLines.join('\n')
    try {
      events.push(JSON.parse(raw) as EvalStreamEvent)
    } catch {
      // ignore malformed; backend should never send these
    }
  }
  return { events, remaining }
}

export interface EvalStreamHandle {
  close(): void
}

export function subscribeEvalRunStream(
  runId: number,
  onEvent: (evt: EvalStreamEvent) => void,
  onError?: (err: Error) => void,
): EvalStreamHandle {
  const ctrl = new AbortController()
  const sid = getAuthSessionId()
  const headers = new Headers({ Accept: 'text/event-stream' })
  if (sid) headers.set('X-Session-Id', sid)

  ;(async () => {
    try {
      const res = await fetch(`${API_BASE}/eval/stability/runs/${runId}/stream`, {
        method: 'GET',
        headers,
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) {
        throw new Error(`Stream ${runId} returned HTTP ${res.status}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const { events, remaining } = parseEvalSse(buf)
        buf = remaining
        for (const evt of events) {
          onEvent(evt)
          if (evt.type === 'done') {
            ctrl.abort()
            return
          }
        }
      }
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return
      onError?.(err as Error)
    }
  })()

  return {
    close: () => ctrl.abort(),
  }
}

/** Markdown export for a completed stability run (client-side). */
export function evalRunToMarkdown(detail: EvalRunDetail): string {
  const { run, results } = detail
  const lines: string[] = [
    `# Stability run #${run.id}`,
    '',
    `- Status: ${run.status}`,
    `- Mode: ${run.mode}`,
    `- Target: ${run.target_model_id}`,
    `- Judge: ${run.judge_model_id}`,
    run.judge_secondary_model_id ? `- Second judge: ${run.judge_secondary_model_id}` : null,
    `- N runs: ${run.n_runs}`,
    run.agg_overall_p50 != null ? `- p50 (primary judge): ${run.agg_overall_p50.toFixed(2)}` : null,
    run.diversity_score != null ? `- Diversity: ${run.diversity_score.toFixed(3)}` : null,
    run.judge_agreement_mean_abs != null
      ? `- Mean |Δ| primary vs secondary: ${run.judge_agreement_mean_abs.toFixed(3)}`
      : null,
    '',
    '## Task',
    run.task_input,
    '',
    '## Prompt A',
    run.prompt_a_text,
    '',
  ].filter(Boolean) as string[]
  if (run.prompt_b_text) {
    lines.push('## Prompt B', run.prompt_b_text, '')
  }
  const rep = run.synthesis_report
  if (rep) {
    lines.push('## Meta-analysis (synthesis)', '', rep.summary ?? '', '')
    if (rep.failure_modes?.length) {
      lines.push('### Failure modes')
      for (const f of rep.failure_modes) {
        lines.push(`- **${f.pattern}** (sev ${f.severity}): ${f.evidence}`)
      }
      lines.push('')
    }
    if (rep.prompt_fixes?.length) {
      lines.push('### Prompt fixes')
      for (const p of rep.prompt_fixes) lines.push(`- ${p}`)
      lines.push('')
    }
  }
  if (run.synthesis_error) {
    lines.push('## Synthesis error', run.synthesis_error, '')
  }
  lines.push('## Outputs')
  for (const r of results) {
    lines.push(
      `### ${r.prompt_side} #${r.run_index} — primary ${r.judge_overall ?? '—'}` +
        (r.judge_overall_secondary != null ? ` / secondary ${r.judge_overall_secondary.toFixed(2)}` : ''),
      '',
      r.output_text,
      '',
    )
  }
  return lines.join('\n')
}

export function downloadEvalRunMarkdown(detail: EvalRunDetail, filename?: string): void {
  const md = evalRunToMarkdown(detail)
  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename ?? `eval-run-${detail.run.id}.md`
  a.click()
  URL.revokeObjectURL(url)
}
