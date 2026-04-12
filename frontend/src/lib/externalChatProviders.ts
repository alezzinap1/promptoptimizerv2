/**
 * Открытие внешних чатов ИИ: браузер не может вставить текст на чужой origin.
 * Стратегия: полный промпт в буфер обмена + вкладка с URL; где сайт поддерживает
 * передачу запроса в query — добавляем (часто укороченную) копию в ссылку.
 */
export type ExternalChatProviderId =
  | 'chatgpt'
  | 'claude'
  | 'grok'
  | 'gemini'
  | 'deepseek'
  | 'mistral'
  | 'perplexity'
  | 'copilot'
  | 'yandexgpt'

export type ExternalChatProvider = {
  id: ExternalChatProviderId
  label: string
  /** Если true — основной способ вставки только Ctrl+V из буфера */
  clipboardPrimary: boolean
}

export const EXTERNAL_CHAT_PROVIDERS: ExternalChatProvider[] = [
  { id: 'chatgpt', label: 'ChatGPT', clipboardPrimary: false },
  { id: 'claude', label: 'Claude', clipboardPrimary: false },
  { id: 'gemini', label: 'Gemini', clipboardPrimary: true },
  { id: 'deepseek', label: 'DeepSeek', clipboardPrimary: true },
  { id: 'mistral', label: 'Le Chat (Mistral)', clipboardPrimary: true },
  { id: 'perplexity', label: 'Perplexity', clipboardPrimary: true },
  { id: 'copilot', label: 'Microsoft Copilot', clipboardPrimary: true },
  { id: 'yandexgpt', label: 'Яндекс GPT (Алиса)', clipboardPrimary: true },
  { id: 'grok', label: 'Grok', clipboardPrimary: true },
]

/** Макс. длина текста в query — длинные промпты только из буфера */
const MAX_QUERY_CHARS = 1600

function clipForUrl(full: string): string {
  if (full.length <= MAX_QUERY_CHARS) return full
  return full.slice(0, MAX_QUERY_CHARS)
}

export function buildExternalChatUrl(id: ExternalChatProviderId, fullPrompt: string): string {
  const q = clipForUrl(fullPrompt.trim())
  const enc = encodeURIComponent(q)
  switch (id) {
    case 'chatgpt':
      return `https://chatgpt.com/?q=${enc}`
    case 'claude':
      return `https://claude.ai/new?q=${enc}`
    case 'grok':
      return `https://grok.com/chat`
    case 'gemini':
      return 'https://gemini.google.com/app'
    case 'deepseek':
      return 'https://chat.deepseek.com/'
    case 'mistral':
      return 'https://chat.mistral.ai/chat'
    case 'perplexity':
      return 'https://www.perplexity.ai/'
    case 'copilot':
      return 'https://copilot.microsoft.com/'
    case 'yandexgpt':
      return 'https://alice.yandex.ru/'
    default:
      return 'https://gemini.google.com/app'
  }
}

export async function copyPromptAndOpenExternalChat(
  id: ExternalChatProviderId,
  fullPrompt: string,
): Promise<void> {
  const text = fullPrompt.trim()
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    /* пользователь может вставить вручную */
  }
  const url = buildExternalChatUrl(id, text)
  window.open(url, '_blank', 'noopener')
}
