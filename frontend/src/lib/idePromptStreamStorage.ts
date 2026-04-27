const PREFIX = 'pe:idePromptStream:v1:'

function djb2(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h << 5) + h + s.charCodeAt(i)
  return (h >>> 0).toString(36)
}

export function idePromptStreamStorageKey(sessionId: string, promptBlock: string): string {
  return `${PREFIX}${sessionId}:${djb2(promptBlock)}`
}

export function markIdePromptStreamSeen(sessionId: string, promptBlock: string): void {
  if (!sessionId?.trim() || !promptBlock.trim()) return
  try {
    sessionStorage.setItem(idePromptStreamStorageKey(sessionId, promptBlock), '1')
  } catch {
    /* quota / private mode */
  }
}

export function isIdePromptStreamSeen(sessionId: string, promptBlock: string): boolean {
  if (!sessionId?.trim() || !promptBlock.trim()) return false
  try {
    return sessionStorage.getItem(idePromptStreamStorageKey(sessionId, promptBlock)) === '1'
  } catch {
    return false
  }
}
