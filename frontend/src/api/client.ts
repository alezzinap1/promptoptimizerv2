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
  skill_body?: string
  prompt_type?: string
  /** Метки стиля для режима «Фото» (передаются в промпт генерации) */
  image_prompt_tags?: string[]
  /** Пресет стиля: встроенный id или u_{id} пользовательский (режим «Фото») */
  image_preset_id?: string | null
  /** Целевой движок (MJ, SD, …) — подсказки синтаксиса на бэкенде, не путать с моделью генерации текста */
  image_engine?: string | null
  /** Двухшаговый режим: сначала дешёвый анализ сцены в JSON, затем основной промпт */
  image_deep_mode?: boolean
  /** Пользовательский пресет для режима «Скилл» (u_{id}) */
  skill_preset_id?: string | null
  /** Недавние id техник — для разнообразия автоподбора на сервере */
  recent_technique_ids?: string[]
  /** Профиль студии: junior | mid | senior | creative — подсказка бэкенду для политики вопросов */
  expert_level?: string | null
}

export type SuggestedStudioAction = {
  id: string
  title: string
  emoji?: string
  action: 'iterate' | 'save_library' | 'eval_prompt' | 'nav_compare'
  data?: { feedback?: string }
}

export function normalizeSuggestedStudioActions(raw: unknown): SuggestedStudioAction[] {
  if (!Array.isArray(raw)) return []
  const out: SuggestedStudioAction[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const id = typeof r.id === 'string' ? r.id : ''
    const title = typeof r.title === 'string' ? r.title : ''
    const action = r.action
    if (
      !id ||
      !title ||
      (action !== 'iterate' &&
        action !== 'save_library' &&
        action !== 'eval_prompt' &&
        action !== 'nav_compare')
    ) {
      continue
    }
    const emoji = typeof r.emoji === 'string' ? r.emoji : undefined
    let data: { feedback?: string } | undefined
    if (r.data && typeof r.data === 'object') {
      const d = r.data as Record<string, unknown>
      if (typeof d.feedback === 'string') data = { feedback: d.feedback }
    }
    out.push({ id, title, emoji, action, data })
  }
  return out
}

export type AgentProcessChatTurn = { role: 'user' | 'assistant'; content: string }

export interface AgentProcessRequest {
  text: string
  session_id?: string | null
  has_prompt?: boolean
  prompt_type?: string
  current_prompt?: string
  /** Последние реплики чата студии; без персистентности на сервере (P0). */
  chat_history?: AgentProcessChatTurn[]
}

export interface AgentProcessResponse {
  action: string
  data: Record<string, unknown>
  reasoning: string
  classification?: Record<string, unknown>
  features?: Record<string, boolean>
  suggested_actions?: SuggestedStudioAction[]
}

export interface ImagePresetOption {
  id: string
  name: string
  description: string
  preview_keywords: string[]
}

export interface ImageEngineOption {
  id: string
  label: string
}

export interface ImageMetaResponse {
  presets: ImagePresetOption[]
  engines?: ImageEngineOption[]
}

export interface UserPresetRecord {
  id: number
  user_id: number
  kind: 'image' | 'skill'
  name: string
  description: string
  payload: { raw_text?: string; hint?: string }
  created_at?: string
}

export type GenerationIssue =
  | 'format_failure'
  | 'questions_unparsed'
  | 'weak_question_options'
  | 'iteration_with_questions'

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
  /** Краткое обоснование выбора каждой техники */
  technique_reasons?: { id: string; reason: string }[]
  context_gap?: number
  questions_policy?: { mode: string; max_questions: number }
  questions_enforced?: boolean
  /** Второй проход questions_contract (серверный) */
  questions_contract_used?: boolean
  /** Успешный vision-бриф при глубоком режиме изображения */
  scene_analysis_applied?: boolean
  task_types: string[]
  complexity: string
  task_input?: string
  gen_model: string
  target_model: string
  /** "reasoning" | "standard" | "small" */
  target_model_type?: string
  metrics: Record<string, unknown>
  /** Оценка входных токенов основного запроса (system + user) до стрима */
  input_token_estimate?: number
  /** Короткое название для библиотеки из блока [TITLE] */
  prompt_title?: string
  session_id: string
  prompt_spec?: PromptSpec
  evidence?: Record<string, PromptIdeEvidence>
  debug_issues?: PromptIdeIssue[]
  intent_graph?: PromptIdeNode[]
  workspace?: Workspace
  suggested_actions?: SuggestedStudioAction[]
  /** Режим студии text | image | skill — с сервера для UI (тесты скилла и т.д.). */
  prompt_type?: string
  /** Сгенерированные проверки для режима skill ([TEST_CASES] в ответе модели). */
  test_cases?: { user: string; expect_substring: string }[]
}

export interface GenerateEstimateResponse {
  input_token_estimate: number
  main_request_tokens: number
  scene_analysis_tokens_estimate: number
  task_preview: {
    completeness_score?: number
    completeness_label?: string
    token_method?: string
  }
  context_gap: number
}

export interface PreviewEditRequest {
  task_input: string
  current_prompt: string
  instruction: string
  prompt_type?: string
  gen_model?: string
}

export interface PreviewEditResponse {
  new_prompt: string
  reasoning?: string
}

export interface ApplySessionPromptRequest {
  final_prompt: string
  copy_metadata_from_version?: number
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
  target_model: string
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

export interface CommunityPrompt {
  id: number
  author_user_id: number
  author_name: string
  title: string
  description: string
  prompt: string
  prompt_type: string
  category: string
  tags: string[]
  upvotes: number
  image_path: string | null
  is_public: number
  voted: boolean
  created_at: string
  updated_at: string
}

export interface SkillRecord {
  id: number
  user_id: number
  name: string
  description: string
  body: string
  category: string
  is_public: number
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

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** Разбирает тело ошибки FastAPI (`{"detail": ...}`) и отдаёт строку для UI */
export type GenerateStreamEvent =
  | { type: 'chunk'; text: string }
  | { type: 'done'; result: GenerateResult }
  | { type: 'error'; message: string }

/** Разбор SSE `data: {...}` из POST /generate/stream (тестируемо отдельно от fetch). */
export async function parseGenerateSseLines(
  body: ReadableStream<Uint8Array> | null,
  onEvent: (e: GenerateStreamEvent) => void,
): Promise<void> {
  if (!body) return
  const reader = body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const parts = buf.split('\n\n')
    buf = parts.pop() || ''
    for (const block of parts) {
      const line = block.trim()
      if (!line.startsWith('data:')) continue
      const jsonStr = line.slice(5).trim()
      if (!jsonStr) continue
      try {
        const j = JSON.parse(jsonStr) as GenerateStreamEvent
        onEvent(j)
      } catch {
        /* ignore malformed line */
      }
    }
  }
}

function parseApiErrorBody(text: string, status: number): string {
  const t = text.trim()
  if (!t) {
    if (status === 401) return 'Требуется вход. Войдите в аккаунт.'
    return `Ошибка ${status}`
  }
  try {
    const j = JSON.parse(t) as { detail?: unknown }
    const d = j.detail
    if (typeof d === 'string') return d
    if (Array.isArray(d)) {
      return d
        .map((x) => {
          if (typeof x === 'string') return x
          if (x && typeof x === 'object' && 'msg' in x && typeof (x as { msg: string }).msg === 'string') {
            return (x as { msg: string }).msg
          }
          return JSON.stringify(x)
        })
        .join('; ')
    }
  } catch {
    /* не JSON */
  }
  if (t.length > 400) return `${t.slice(0, 380)}…`
  return t
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

  const text = await res.text()

  if (!res.ok) {
    const msg = parseApiErrorBody(text, res.status)
    throw new ApiError(msg, res.status)
  }

  const ct = (res.headers.get('content-type') || '').toLowerCase()
  const trimmed = text.trimStart()
  if (!ct.includes('application/json') && (trimmed.startsWith('<!') || trimmed.startsWith('<'))) {
    throw new ApiError(
      'Сервер вернул HTML вместо JSON (часто index.html). Проверьте, что backend запущен и запросы к /api не отдают SPA.',
      res.status,
    )
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiError(
      'Ответ не JSON. Запустите backend (uvicorn) и при разработке — прокси Vite на порт API.',
      res.status,
    )
  }
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

  simpleImprove: (req: {
    prompt_text: string
    gen_model?: string
    preset?: string
    target_model?: string
  }) =>
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
    prompt_type?: string
  }) => fetchApi<PromptIdePreviewResponse>('/prompt-ide/preview', { method: 'POST', body: JSON.stringify(req) }),

  generate: (req: GenerateRequest) =>
    fetchApi<GenerateResult>('/generate', { method: 'POST', body: JSON.stringify(req) }),
  generateStream: async (
    req: GenerateRequest,
    onEvent: (e: GenerateStreamEvent) => void,
    init?: RequestInit,
  ) => {
    const headers = new Headers(init?.headers)
    headers.set('Content-Type', 'application/json')
    const sessionId = getAuthSessionId()
    if (sessionId) headers.set('X-Session-Id', sessionId)
    const res = await fetch(`${API_BASE}/generate/stream`, {
      method: 'POST',
      body: JSON.stringify(req),
      headers,
      ...init,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new ApiError(parseApiErrorBody(text, res.status), res.status)
    }
    await parseGenerateSseLines(res.body, onEvent)
  },
  previewPromptEdit: (req: PreviewEditRequest) =>
    fetchApi<PreviewEditResponse>('/generate/preview-edit', { method: 'POST', body: JSON.stringify(req) }),
  estimateGenerate: (req: GenerateRequest) =>
    fetchApi<GenerateEstimateResponse>('/generate/estimate', { method: 'POST', body: JSON.stringify(req) }),
  getImageOptions: () => fetchApi<ImageMetaResponse>('/meta/image-options'),
  listPresets: (kind?: 'image' | 'skill') =>
    fetchApi<{ items: UserPresetRecord[] }>(kind ? `/presets?kind=${kind}` : '/presets'),
  createPreset: (req: {
    kind: 'image' | 'skill'
    name: string
    description?: string
    payload: { raw_text?: string; hint?: string }
  }) => fetchApi<{ item: UserPresetRecord }>('/presets', { method: 'POST', body: JSON.stringify(req) }),
  updatePreset: (
    id: number,
    req: { name?: string; description?: string; payload?: { raw_text?: string; hint?: string } },
  ) => fetchApi<{ item: UserPresetRecord }>(`/presets/${id}`, { method: 'PATCH', body: JSON.stringify(req) }),
  deletePreset: (id: number) => fetchApi<{ ok: boolean }>(`/presets/${id}`, { method: 'DELETE' }),

  semanticAgentRoute: (req: { text: string; has_prompt?: boolean }) =>
    fetchApi<{
      intent: string | null
      confidence: number
      margin: number
      backend: string
      rejected_reason?: string
    }>('/agent/semantic-route', { method: 'POST', body: JSON.stringify(req) }),

  agentProcess: (req: AgentProcessRequest, init?: RequestInit) =>
    fetchApi<AgentProcessResponse>('/agent/process', {
      method: 'POST',
      body: JSON.stringify(req),
      ...init,
    }),

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
  applySessionPrompt: (sessionId: string, body: ApplySessionPromptRequest) =>
    fetchApi<{ ok: boolean; item: Record<string, unknown> | null }>(
      `/sessions/${encodeURIComponent(sessionId)}/apply-prompt`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
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

  evaluatePrompt: (prompt: string, targetModel?: string, promptType?: string) =>
    fetchApi<{ metrics: Record<string, unknown> }>('/library/evaluate', {
      method: 'POST',
      body: JSON.stringify({
        prompt,
        target_model: targetModel || '',
        prompt_type: promptType || 'text',
      }),
    }),

  // Community prompts
  getCommunity: (params?: { prompt_type?: string; category?: string; search?: string; sort?: string; limit?: number; offset?: number }) =>
    fetchApi<{ items: CommunityPrompt[] }>(`/community${toQueryString(params)}`),
  getCommunityPrompt: (id: number) =>
    fetchApi<{ item: CommunityPrompt }>(`/community/${id}`),
  createCommunityPrompt: (req: { title: string; prompt: string; description?: string; prompt_type?: string; category?: string; tags?: string[]; image_path?: string | null }) =>
    fetchApi<{ id: number }>('/community', { method: 'POST', body: JSON.stringify(req) }),
  updateCommunityPrompt: (id: number, req: { title?: string; description?: string; prompt?: string; tags?: string[]; category?: string }) =>
    fetchApi<{ ok: boolean }>(`/community/${id}`, { method: 'PATCH', body: JSON.stringify(req) }),
  deleteCommunityPrompt: (id: number) =>
    fetchApi<{ ok: boolean }>(`/community/${id}`, { method: 'DELETE' }),
  voteCommunityPrompt: (id: number) =>
    fetchApi<{ voted: boolean }>(`/community/${id}/vote`, { method: 'POST' }),
  uploadCommunityImage: async (file: File): Promise<{ path: string }> => {
    const formData = new FormData()
    formData.append('file', file)
    const headers: Record<string, string> = {}
    const sessionId = getAuthSessionId()
    if (sessionId) headers['X-Session-Id'] = sessionId
    const res = await fetch(`${API_BASE}/community/upload-image`, { method: 'POST', body: formData, headers })
    const text = await res.text()
    if (!res.ok) {
      let msg = `Ошибка загрузки (${res.status})`
      try {
        const j = JSON.parse(text) as { detail?: unknown }
        if (typeof j.detail === 'string') msg = j.detail
      } catch {
        /* ignore */
      }
      throw new ApiError(msg, res.status)
    }
    try {
      return JSON.parse(text) as { path: string }
    } catch {
      throw new ApiError('Ответ сервера не JSON', res.status)
    }
  },

  // Skills
  skillSandboxChat: (req: { skill_body: string; user_message: string; gen_model?: string }) =>
    fetchApi<{ reply: string; gen_model: string }>('/skills/sandbox/chat', {
      method: 'POST',
      body: JSON.stringify(req),
    }),

  getSkills: () => fetchApi<{ items: SkillRecord[] }>('/skills'),
  createSkill: (req: { name: string; body: string; description?: string; category?: string }) =>
    fetchApi<{ id: number }>('/skills', { method: 'POST', body: JSON.stringify(req) }),
  getSkill: (id: number) => fetchApi<{ item: SkillRecord }>(`/skills/${id}`),
  updateSkill: (id: number, req: { name?: string; description?: string; body?: string; category?: string }) =>
    fetchApi<{ ok: boolean }>(`/skills/${id}`, { method: 'PATCH', body: JSON.stringify(req) }),
  deleteSkill: (id: number) => fetchApi<{ ok: boolean }>(`/skills/${id}`, { method: 'DELETE' }),
  generateSkill: (description: string, genModel?: string) =>
    fetchApi<{ generated_body: string }>('/skills/generate', {
      method: 'POST',
      body: JSON.stringify({ description, gen_model: genModel || '' }),
    }),
}
