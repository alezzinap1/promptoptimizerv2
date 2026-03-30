/**
 * Сообщения без явной задачи на промпт — отвечаем в чате, без вызова генерации.
 */
const GREETING_PATTERNS = [
  /^привет\b/i,
  /^здравствуй/i,
  /^добрый\s+(день|вечер|утро)\b/i,
  /^hi\b/i,
  /^hello\b/i,
  /^hey\b/i,
  /^yo\b/i,
  /^хай\b/i,
  /^салют\b/i,
  /^дратути\b/i,
]

/** Односложные «пустые» реплики */
const MINIMAL_RE = /^(ок|окей|okay|да|нет|спасибо|thanks|thx|понял|понятно|ладно|хорошо)\.?$/i

export function isConversationalOnlyMessage(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return true
  if (t.length > 120) return false
  if (MINIMAL_RE.test(t)) return true
  const words = t.split(/\s+/).filter(Boolean)
  if (words.length <= 4) {
    for (const re of GREETING_PATTERNS) {
      if (re.test(t)) return true
    }
  }
  return false
}
