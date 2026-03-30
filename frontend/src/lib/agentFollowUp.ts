/**
 * Rule-based маршрутизация после появления промпта (fallback, если семантический роутер недоступен).
 * Семантика: POST /api/agent/semantic-route (fastembed, см. services/semantic_agent_router.py).
 */

export type FollowUpPlan =
  | { type: 'iterate'; debug: string }
  | { type: 'chat'; text: string; debug: string }
  | { type: 'save_library'; tags: string[]; titleHint?: string; debug: string }
  | { type: 'eval_prompt'; debug: string }
  | { type: 'show_versions'; debug: string }
  | { type: 'nav_compare'; debug: string }
  | { type: 'nav_library'; search?: string; debug: string }
  | { type: 'nav_skills'; debug: string }

export const AGENT_PRODUCT_HELP_TEXT = `Кратко про интерфейс:
• **Версии** — каждая генерация в этой сессии сохраняется; переключайте «таблетки» v1, v2… под промптом.
• **Библиотека** — кнопка «В библиотеку» или напишите «сохрани в библиотеку с тегами …».
• **Сравнение** — кнопка «Сравнить» или попросите «открой сравнение».
• **Полнота** — эвристика по структуре текста промпта; это не оценка ответа модели в чате.

Чтобы **изменить текст промпта**, опишите правку явно (например: «убери третий пункт», «добавь пример»).`

function looksLikeEditCommand(t: string): boolean {
  const s = t.trim()
  if (/^(измени|убери|добавь|замени|перепиши|сократ|удлин|вставь|удали|поправь|улучши|дополни|расширь|сжать|формализуй)\b/i.test(s))
    return true
  if (/\b(сделай\s+(короче|длиннее|проще|строже|формальн)|короче|длиннее|проще)\b/i.test(t)) return true
  if (/^(убери|добавь|замени)\s+.+/i.test(s)) return true
  return false
}

/** Явная правка промпта — имеет приоритет над семантическим классификатором. */
export function looksLikeStrongEdit(t: string): boolean {
  return looksLikeEditCommand(t.replace(/\s+/g, ' ').trim())
}

function looksLikeMetaOrProductQuestion(t: string): boolean {
  const low = t.toLowerCase()
  if (/^(а\s+)?(как|что|почему|объясни|расскажи|где|когда|зачем)\b/i.test(t.trim())) return true
  const needles = [
    'версионирован',
    'версии ',
    'версия ',
    'библиотек',
    'интерфейс',
    'как ты ',
    'как вы ',
    'что такое',
    'как работает',
    'как устроен',
    'полноту ',
    'оцениваешь',
    'оцениваете',
    'сколько стоит',
    'trial',
    'лимит',
  ]
  return needles.some((n) => low.includes(n))
}

export function parseTagsFromText(t: string): string[] {
  const m = t.match(/тег(?:и|ами)?\s*[:\-]?\s*([^\n.?!]+)/i)
  if (!m) return []
  return m[1]
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 24)
}

export function parseTitleHint(t: string): string | undefined {
  const m = t.match(/(?:как|названием|название|заголовок)\s+["«']([^"»']+)["»']|названием\s+([^\n.?!]{2,80})/i)
  if (m) return (m[1] || m[2] || '').trim() || undefined
  return undefined
}

/** Сообщение в чате после того, как промпт уже есть справа */
export function classifyAgentFollowUp(text: string): FollowUpPlan {
  const raw = text.replace(/\s+/g, ' ').trim()
  const low = raw.toLowerCase()

  if (/сохрани|в\s+библиотек|save\s+to\s+library|добавь\s+в\s+библиотек/i.test(raw)) {
    return {
      type: 'save_library',
      tags: parseTagsFromText(raw),
      titleHint: parseTitleHint(raw),
      debug: `save_library tags=${JSON.stringify(parseTagsFromText(raw))}`,
    }
  }

  if (
    /оцени\s+(промпт|текст)|eval(uate)?\s+prompt|полноту\s+промпта|качеств(?:о|а)\s+промпта/i.test(raw) ||
    (/оцени\b/i.test(raw) && low.includes('промпт'))
  ) {
    return { type: 'eval_prompt', debug: 'eval_prompt' }
  }

  if (/верси(?:и|я|й|ю)|истори(?:я|и)\s+промпт|что\s+за\s+верси/i.test(raw)) {
    return { type: 'show_versions', debug: 'show_versions' }
  }

  if (/сравни|сравнение|a\s*\/\s*b|ab\s+тест/i.test(raw)) {
    return { type: 'nav_compare', debug: 'nav_compare' }
  }

  if (/скилл|skill|навык/i.test(raw) && /открой|покажи|перейди|библиотек/i.test(raw)) {
    return { type: 'nav_skills', debug: 'nav_skills' }
  }

  if (
    /(?:открой|покажи|перейди|загляни)\b/i.test(raw) &&
    (/(?:библиотек|промпт(?:ы|ов))/i.test(raw) || /мои\s+промпты/i.test(low))
  ) {
    const q = raw.match(/по\s+(?:запросу|искомому|тексту)\s+["«']([^"»']+)["»']/i)
    return {
      type: 'nav_library',
      search: q?.[1]?.trim(),
      debug: 'nav_library',
    }
  }

  if (looksLikeMetaOrProductQuestion(raw) && !looksLikeEditCommand(raw)) {
    return { type: 'chat', text: AGENT_PRODUCT_HELP_TEXT, debug: 'product_help' }
  }

  return { type: 'iterate', debug: 'edit_prompt_default' }
}
