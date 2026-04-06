const KEY = 'metaprompt-recent-technique-ids'

/** Последние id техник для штрафа повторов на бэкенде (research: session penalty). */
export function loadRecentTechniqueIds(): string[] {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return []
    const a = JSON.parse(raw) as unknown
    if (!Array.isArray(a)) return []
    return a.filter((x): x is string => typeof x === 'string').slice(-28)
  } catch {
    return []
  }
}

export function appendRecentTechniqueIds(ids: string[]): void {
  if (!ids.length) return
  const prev = loadRecentTechniqueIds()
  sessionStorage.setItem(KEY, JSON.stringify([...prev, ...ids].slice(-28)))
}
