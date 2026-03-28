/** Короткое человекочитаемое имя записи в библиотеке (не сырой многострочный запрос). */
export function suggestLibraryTitle(taskText: string, maxWords = 7): string {
  const raw = taskText.replace(/\s+/g, ' ').trim()
  if (!raw) return 'Без названия'

  const words = raw.split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'Без названия'

  const chunk = words.slice(0, maxWords).join(' ')
  const clipped = chunk.length > 52 ? `${chunk.slice(0, 49).trimEnd()}…` : chunk
  const first = clipped.charAt(0).toUpperCase()
  return first + clipped.slice(1)
}
