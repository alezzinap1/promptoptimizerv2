const KEY = 'metaprompt-tag-accent-v1'

function load(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const o = JSON.parse(raw) as Record<string, unknown>
    if (!o || typeof o !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v)) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function save(map: Record<string, string>) {
  localStorage.setItem(KEY, JSON.stringify(map))
}

export function getTagAccent(tag: string): string | undefined {
  const k = tag.trim().toLowerCase()
  if (!k) return undefined
  return load()[k]
}

export function setTagAccent(tag: string, hex: string): void {
  const k = tag.trim().toLowerCase()
  if (!k) return
  let h = hex.trim()
  if (!/^#[0-9A-Fa-f]{6}$/.test(h)) return
  const m = load()
  m[k] = h
  save(m)
  window.dispatchEvent(new CustomEvent('metaprompt-tag-accent-changed'))
}
