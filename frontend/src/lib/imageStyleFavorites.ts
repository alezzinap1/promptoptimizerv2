const KEY = 'metaprompt-image-style-favorites-v1'

export function loadImageStyleFavoriteIds(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((x): x is string => typeof x === 'string' && x.length > 0))
  } catch {
    return new Set()
  }
}

export function saveImageStyleFavoriteIds(ids: Set<string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...ids]))
  } catch {
    /* ignore */
  }
}
