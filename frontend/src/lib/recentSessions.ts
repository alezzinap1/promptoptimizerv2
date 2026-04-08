const KEY = 'metaprompt-recent-sessions-v1'
const MAX = 5

export type RecentSession = {
  sessionId: string
  label: string
  at: number
}

function normalizeLabel(task: string): string {
  const one = task.replace(/\s+/g, ' ').trim()
  if (!one) return 'Сессия'
  const words = one.split(' ')
  if (words.length <= 5) return one
  return words.slice(0, 5).join(' ') + '…'
}

export function pushRecentSession(sessionId: string, taskPreview: string, titleOverride?: string): void {
  if (!sessionId) return
  let list: RecentSession[] = []
  try {
    const raw = localStorage.getItem(KEY)
    const p = raw ? JSON.parse(raw) : []
    list = Array.isArray(p) ? p : []
  } catch {
    list = []
  }
  const t = (titleOverride || '').trim()
  const label = t ? normalizeLabel(t) : normalizeLabel(taskPreview)
  list = list.filter((x) => x.sessionId !== sessionId)
  list.unshift({ sessionId, label, at: Date.now() })
  list = list.slice(0, MAX)
  localStorage.setItem(KEY, JSON.stringify(list))
  window.dispatchEvent(new Event('metaprompt-recent-sessions'))
}

export function getRecentSessions(): RecentSession[] {
  try {
    const raw = localStorage.getItem(KEY)
    const p = raw ? JSON.parse(raw) : []
    if (!Array.isArray(p)) return []
    return p.filter((x) => x && typeof x.sessionId === 'string')
  } catch {
    return []
  }
}
