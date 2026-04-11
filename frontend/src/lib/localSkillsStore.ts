/** Локальные скиллы (тот же storage, что вкладка «Скиллы» в библиотеке). */

export const LOCAL_SKILLS_STORAGE_KEY = 'prompt-engineer-skills-v1'

export type SkillItem = {
  id: string
  title: string
  description: string
  frameworks: string[]
  tags: string[]
  body: string
  createdAt: string
}

function normalizeSkill(raw: unknown): SkillItem | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.title !== 'string' || typeof o.body !== 'string') return null
  const frameworks = Array.isArray(o.frameworks) ? o.frameworks.filter((x): x is string => typeof x === 'string') : []
  const tags = Array.isArray(o.tags) ? o.tags.filter((x): x is string => typeof x === 'string') : []
  return {
    id: o.id,
    title: o.title,
    description: typeof o.description === 'string' ? o.description : '',
    frameworks,
    tags,
    body: o.body,
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : new Date().toISOString(),
  }
}

export function loadLocalSkills(): SkillItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_SKILLS_STORAGE_KEY)
    if (!raw) return []
    const p = JSON.parse(raw)
    if (!Array.isArray(p)) return []
    return p
      .map(normalizeSkill)
      .filter((x): x is SkillItem => x !== null)
      .map((it) => ({ ...it, tags: it.tags?.length ? it.tags : [] }))
  } catch {
    return []
  }
}

export function saveLocalSkills(items: SkillItem[]): void {
  localStorage.setItem(LOCAL_SKILLS_STORAGE_KEY, JSON.stringify(items))
}

export function appendLocalSkill(params: {
  title: string
  body: string
  description?: string
  tags?: string[]
  frameworks?: string[]
}): SkillItem {
  const items = loadLocalSkills()
  const id = `sk_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  const item: SkillItem = {
    id,
    title: params.title.trim(),
    description: (params.description || '').trim(),
    frameworks: params.frameworks?.length ? params.frameworks : [],
    tags: params.tags?.length ? params.tags : [],
    body: params.body.trim(),
    createdAt: new Date().toISOString(),
  }
  saveLocalSkills([...items, item])
  return item
}

const EXPORT_FORMAT_VERSION = 1

export type LocalSkillsExportBundle = {
  format: 'metaprompt-local-skills'
  version: number
  exportedAt: string
  skills: SkillItem[]
}

export function buildLocalSkillsExportBundle(): LocalSkillsExportBundle {
  return {
    format: 'metaprompt-local-skills',
    version: EXPORT_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    skills: loadLocalSkills(),
  }
}

export function serializeLocalSkillsExport(): string {
  return JSON.stringify(buildLocalSkillsExportBundle(), null, 2)
}

export function importLocalSkillsBundle(
  json: string,
  mode: 'merge' | 'replace',
): { ok: true; count: number } | { ok: false; error: string } {
  try {
    const data = JSON.parse(json) as unknown
    if (!data || typeof data !== 'object') return { ok: false, error: 'Неверный файл.' }
    const o = data as Record<string, unknown>
    const rawSkills = o.skills
    if (!Array.isArray(rawSkills)) return { ok: false, error: 'В файле нет массива skills.' }
    const parsed: SkillItem[] = []
    for (const row of rawSkills) {
      const it = normalizeSkill(row)
      if (it) parsed.push(it)
    }
    if (mode === 'replace') {
      saveLocalSkills(parsed)
      return { ok: true, count: parsed.length }
    }
    const existing = loadLocalSkills()
    const byId = new Map(existing.map((x) => [x.id, x]))
    for (const it of parsed) {
      byId.set(it.id, it)
    }
    const merged = [...byId.values()].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    saveLocalSkills(merged)
    return { ok: true, count: parsed.length }
  } catch {
    return { ok: false, error: 'Не удалось прочитать JSON.' }
  }
}
