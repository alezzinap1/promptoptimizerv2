const API_BASE = '/api'
const AUTH_STORAGE_KEY = 'prompt-engineer-auth-session'

export interface User {
  id: number
  username: string
  email?: string | null
  avatar_url?: string | null
}

export interface AuthResponse {
  session_id: string
  user: User
}

export interface PromptIdeIssue {
  severity: string
  category: string
  message: string
  why_it_matters: string
  suggested_fix: string
  affected_fields: string[]
}

export interface PromptIdeNode {
  id: string
  label: string
  value: string
  status: string
  criticality: string
}

export interface PromptIdeEvidence {
  source_type: string
  confidence: number
  reason: string
  value_preview: string
  can_accept_reject: boolean
}

export interface PromptSpec {
  goal?: string
  task_types?: string[]
  complexity?: string
  target_model?: string
  workspace_id?: number | null
  workspace_name?: string | null
  audience?: string | null
  input_description?: string
  output_format?: string | null
  constraints?: string[]
  success_criteria?: string[]
  source_of_truth?: string[]
  previous_prompt?: string | null
  workspace_context?: Record<string, unknown>
}

export interface Workspace {
  id: number | null
  name: string
  description: string
  config: {
    preferred_target_model?: string
    glossary?: string[]
    style_rules?: string[]
    default_constraints?: string[]
    reference_snippets?: string[]
  }
}

export interface StructuredQuestion {
  question: string
  options: string[]
}

export interface GenerateRequest {
  task_input: string
  feedback?: string
  gen_model?: string
  target_model?: string
  domain?: string
  technique_mode?: string
  manual_techs?: string[]
  temperature?: number
  top_p?: number
  top_k?: number
  questions_mode?: boolean
  session_id?: string
  previous_prompt?: string
  workspace_id?: number | null
  prompt_spec_overrides?: Record<string, unknown>
  evidence_decisions?: Record<string, string>
  question_answers?: { question: string; answers: string[] }[]
}

export type GenerationIssue =
  | 'format_failure'
  | 'questions_unparsed'
  | 'weak_question_options'

export interface GenerateResult {
  prompt_block: string
  reasoning: string
  has_prompt: boolean
  has_questions: boolean
  /** Полный текст ответа модели (для отладки / если парсер не нашёл [PROMPT]) */
  llm_raw?: string
  generation_issue?: GenerationIssue | null
  generation_flags?: {
    format_failure: boolean
    questions_unparsed: boolean
    weak_question_options: boolean
  }
  questions_raw?: string
  questions?: StructuredQuestion[]
  techniques: { id: string; name: string }[]
  technique_ids: string[]
  task_types: string[]
  complexity: string
  task_input?: string
  gen_model: string
  target_model: string
  /** "reasoning" | "standard" | "small" */
  target_model_type?: string
  metrics: Record<string, unknown>
  session_id: string
  prompt_spec?: PromptSpec
  evidence?: Record<string, PromptIdeEvidence>
  debug_issues?: PromptIdeIssue[]
  intent_graph?: PromptIdeNode[]
  workspace?: Workspace
}

export interface PromptIdePreviewResponse {
  classification: { task_types: string[]; complexity: string }
  techniques: { id: string; name: string }[]
  prompt_spec: PromptSpec
  evidence: Record<string, PromptIdeEvidence>
  debug_issues: PromptIdeIssue[]
  intent_graph: PromptIdeNode[]
  workspace: Workspace
}

export interface Settings {
  openrouter_api_key_set: boolean
  openrouter_api_key_masked: string
  theme: string
  font: string
  /** dark | light — освещение интерфейса */
  color_mode?: string
  preferred_generation_models: string[]
  preferred_target_models: string[]
  simple_improve_preset: string
  simple_improve_meta: string
  /** heuristic | llm — классификация задачи на Home */
  task_classification_mode?: string
  /** OpenRouter id или короткий ключ для LLM-классификатора */
  task_classifier_model?: string
}

export interface SimpleImproveResponse {
  improved_text: string
  preset_used: string
  gen_model: string
}

export interface CompareVariant {
  prompt: string
  reasoning: string
  techniques: { id: string; name: string }[]
  metrics: Record<string, unknown>
}

export interface CompareResponse {
  a: CompareVariant
  b: CompareVariant
  winner: 'a' | 'b' | 'tie'
  winner_heuristic_note?: string
}

export interface CompareJudgeResponse {
  winner: 'a' | 'b' | 'tie'
  reasoning: string
  scores: Record<string, unknown> | null
  parse_error?: boolean
}

export interface LibraryItem {
  id: number
  title: string
  prompt: string
  tags: string[]
  target_model: string
  task_type: string
  rating: number
  notes: string
  techniques: string[]
  created_at: string
  updated_at: string
}

export interface OpenRouterModel {
  id: string
  name: string
  description?: string
  context_length?: number
  pricing: { prompt?: number; completion?: number }
  top_provider?: Record<string, unknown>
  architecture?: Record<string, unknown>
}

export interface TechniqueRecord {
  id: string
  db_id?: number | null
  name: string
  core_pattern?: string
  why_it_works?: string
  good_example?: string
  anti_patterns?: string[]
  variants?: { name?: string; pattern?: string; use_when?: string }[]
  when_to_use?: { task_types?: string[]; complexity?: string[]; not_for?: string[] }
  compatibility?: { combines_well_with?: string[] }
  origin?: 'default' | 'custom'
  editable?: boolean
}

function getAuthSessionId(): string | null {
  return localStorage.getItem(AUTH_STORAGE_KEY)
}

function toQueryString(params?: Record<string, string | number | boolean | undefined | null>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

export function setAuthSessionId(sessionId: string | null) {
  if (sessionId) localStorage.setItem(AUTH_STORAGE_KEY, sessionId)
  else localStorage.removeItem(AUTH_STORAGE_KEY)
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers)
  headers.set('Content-Type', 'application/json')
  const sessionId = getAuthSessionId()
  if (sessionId) headers.set('X-Session-Id', sessionId)

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(err || `HTTP ${res.status}`)
  }
  return res.json()
}

export const api = {
  register: (req: { username: string; password: string; email?: string }) =>
    fetchApi<AuthResponse>('/auth/register', { method: 'POST', body: JSON.stringify(req) }),
  login: (req: { username: string; password: string }) =>
    fetchApi<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify(req) }),
  logout: () => fetchApi<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  me: () => fetchApi<{ user: User }>('/auth/me'),
  updateEmail: (email: string) =>
    fetchApi<{ ok: boolean; email: string }>('/auth/me/email', { method: 'PATCH', body: JSON.stringify({ email }) }),

  getSettings: () => fetchApi<Settings>('/settings'),
  updateSettings: (req: {
    openrouter_api_key?: string
    theme?: string
    font?: string
    color_mode?: string
    preferred_generation_models?: string[]
    preferred_target_models?: string[]
    simple_improve_preset?: string
    simple_improve_meta?: string
    task_classification_mode?: string
    task_classifier_model?: string
  }) =>
    fetchApi<Settings>('/settings', { method: 'PATCH', body: JSON.stringify(req) }),

  simpleImprove: (req: { prompt_text: string; gen_model?: string; preset?: string }) =>
    fetchApi<SimpleImproveResponse>('/simple-improve', { method: 'POST', body: JSON.stringify(req) }),

  previewPromptIde: (req: {
    task_input: string
    target_model?: string
    workspace_id?: number | null
    previous_prompt?: string
    technique_mode?: string
    manual_techs?: string[]
    overrides?: Record<string, unknown>
    evidence_decisions?: Record<string, string>
  }) => fetchApi<PromptIdePreviewResponse>('/prompt-ide/preview', { method: 'POST', body: JSON.stringify(req) }),

  generate: (req: GenerateRequest) =>
    fetchApi<GenerateResult>('/generate', { method: 'POST', body: JSON.stringify(req) }),

  getDomains: () => fetchApi<{ domains: { id: string; name: string }[] }>('/domains'),

  compare: (req: {
    task_input: string
    gen_model?: string
    target_model?: string
    temperature?: number
    top_p?: number
    techs_a_mode?: string
    techs_a_manual?: string[]
    techs_b_mode?: string
    techs_b_manual?: string[]
  }) => fetchApi<CompareResponse>('/compare', { method: 'POST', body: JSON.stringify(req) }),

  compareJudge: (req: { task_input: string; prompt_a: string; prompt_b: string; judge_model?: string }) =>
    fetchApi<CompareJudgeResponse>('/compare/judge', { method: 'POST', body: JSON.stringify(req) }),

  getLibrary: (params?: { target_model?: string; task_type?: string; search?: string }) => {
    return fetchApi<{ items: LibraryItem[] }>(`/library${toQueryString(params)}`)
  },
  getLibraryStats: () => fetchApi<{ total: number; models: string[]; task_types: string[] }>('/library/stats'),
  saveToLibrary: (req: { title: string; prompt: string; tags?: string[]; target_model?: string; task_type?: string; techniques?: string[]; notes?: string }) =>
    fetchApi<{ id: number }>('/library', { method: 'POST', body: JSON.stringify(req) }),
  updateLibrary: (id: number, req: { title?: string; prompt?: string; tags?: string[]; notes?: string; rating?: number }) =>
    fetchApi<{ ok: boolean }>(`/library/${id}`, { method: 'PATCH', body: JSON.stringify(req) }),
  deleteLibrary: (id: number) =>
    fetchApi<{ ok: boolean }>(`/library/${id}`, { method: 'DELETE' }),

  getTechniques: (params?: { task_type?: string; complexity?: string; search?: string }) => {
    return fetchApi<{ techniques: TechniqueRecord[] }>(`/techniques${toQueryString(params)}`)
  },
  createTechnique: (req: TechniqueRecord) =>
    fetchApi<{ item: TechniqueRecord }>('/techniques', { method: 'POST', body: JSON.stringify(req) }),
  updateTechnique: (id: number, req: TechniqueRecord) =>
    fetchApi<{ item: TechniqueRecord }>(`/techniques/${id}`, { method: 'PATCH', body: JSON.stringify(req) }),
  deleteTechnique: (id: number) =>
    fetchApi<{ ok: boolean }>(`/techniques/${id}`, { method: 'DELETE' }),

  getModels: (refresh?: boolean) => {
    const q = refresh ? '?refresh=true' : ''
    return fetchApi<{ data: OpenRouterModel[]; updated_at: number; from_cache: boolean; trial_mode?: boolean; stale?: boolean; error?: string }>(`/models${q}`)
  },

  getUserInfo: () =>
    fetchApi<{
      tokens_used: number
      dollars_used: number
      has_own_api_key: boolean
      trial_tokens_limit: number
      trial_tokens_remaining: number | null
      trial_max_completion_per_m: number
      service_info: { title: string; description: string; features: string[] }
    }>('/user-info'),

  getSessionVersions: (sessionId: string) =>
    fetchApi<{ items: Record<string, unknown>[] }>(`/sessions/${sessionId}/versions`),
  getSessionPromptSpec: (sessionId: string) =>
    fetchApi<{ item: Record<string, unknown> | null }>(`/sessions/${sessionId}/prompt-spec`),

  getWorkspaces: () => fetchApi<{ items: Workspace[] }>('/workspaces'),
  getWorkspace: (id: number) => fetchApi<{ item: Workspace }>('/workspaces/' + id),
  createWorkspace: (req: {
    name: string
    description?: string
    preferred_target_model?: string
    glossary?: string[]
    style_rules?: string[]
    default_constraints?: string[]
    reference_snippets?: string[]
  }) => fetchApi<{ item: Workspace }>('/workspaces', { method: 'POST', body: JSON.stringify(req) }),
  updateWorkspace: (id: number, req: Record<string, unknown>) =>
    fetchApi<{ item: Workspace }>(`/workspaces/${id}`, { method: 'PATCH', body: JSON.stringify(req) }),
  deleteWorkspace: (id: number) =>
    fetchApi<{ ok: boolean }>(`/workspaces/${id}`, { method: 'DELETE' }),

  getMetricsSummary: () => fetchApi<Record<string, unknown>>('/metrics/summary'),
  getMetricsEvents: (limit?: number) =>
    fetchApi<{ items: Record<string, unknown>[] }>(`/metrics/events${limit ? `?limit=${limit}` : ''}`),

  countTokens: (text: string, modelId?: string) =>
    fetchApi<{ tokens: number; method: string; model: string }>('/tokenizer/count', {
      method: 'POST',
      body: JSON.stringify({ text, model_id: modelId || '' }),
    }),

  evaluatePrompt: (prompt: string, targetModel?: string) =>
    fetchApi<{ metrics: Record<string, unknown> }>('/library/evaluate', {
      method: 'POST',
      body: JSON.stringify({ prompt, target_model: targetModel || '' }),
    }),
}
