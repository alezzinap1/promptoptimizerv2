const API_BASE = '/api'

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(err || `HTTP ${res.status}`)
  }
  return res.json()
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
}

export interface GenerateResult {
  prompt_block: string
  reasoning: string
  has_prompt: boolean
  has_questions: boolean
  questions_raw?: string
  techniques: { id: string; name: string }[]
  technique_ids: string[]
  task_types: string[]
  complexity: string
  gen_model: string
  target_model: string
  metrics: Record<string, unknown>
  session_id: string
}

export const api = {
  generate: (req: GenerateRequest) =>
    fetchApi<GenerateResult>(`/generate`, { method: 'POST', body: JSON.stringify(req) }),

  getProviders: () => fetchApi<{ providers: string[]; labels: Record<string, string> }>('/providers'),
  getTargetModels: () => fetchApi<{ models: string[]; labels: Record<string, string> }>('/target-models'),
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
  }) => fetchApi<{ a: { prompt: string; reasoning: string; techniques: unknown[]; metrics: unknown }; b: unknown }>('/compare', { method: 'POST', body: JSON.stringify(req) }),

  getLibrary: (params?: { target_model?: string; task_type?: string; search?: string }) => {
    const q = new URLSearchParams(params as Record<string, string>).toString()
    return fetchApi<{ items: unknown[] }>(`/library${q ? `?${q}` : ''}`)
  },
  getLibraryStats: () => fetchApi<{ total: number; models: string[]; task_types: string[] }>('/library/stats'),
  saveToLibrary: (req: { title: string; prompt: string; tags?: string[]; target_model?: string; task_type?: string; techniques?: string[]; notes?: string }) =>
    fetchApi<{ id: number }>('/library', { method: 'POST', body: JSON.stringify(req) }),
  updateLibrary: (id: number, req: { title?: string; tags?: string[]; notes?: string; rating?: number }) =>
    fetchApi<{ ok: boolean }>(`/library/${id}`, { method: 'PATCH', body: JSON.stringify(req) }),
  deleteLibrary: (id: number) =>
    fetchApi<{ ok: boolean }>(`/library/${id}`, { method: 'DELETE' }),

  getTechniques: (params?: { task_type?: string; complexity?: string; search?: string }) => {
    const q = new URLSearchParams(params as Record<string, string>).toString()
    return fetchApi<{ techniques: unknown[] }>(`/techniques${q ? `?${q}` : ''}`)
  },
}
