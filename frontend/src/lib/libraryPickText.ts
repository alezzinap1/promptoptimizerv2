import type { LibraryItem } from '../api/client'

export function libraryPromptText(item: LibraryItem): string {
  return (item.prompt || '').trim()
}

/** Сообщение пользователя / тестовый user-turn: заметки или нейтральная заготовка. */
export function libraryUserTurnFromCard(item: LibraryItem): string {
  const notes = (item.notes || '').trim()
  if (notes) return notes
  return (
    'Следуй инструкциям промпта и ответь на типичный запрос в рамках этой задачи. Контекст можно уточнить в поле «Задача».'
  )
}

/** Описание задачи для генерации (режим техник и т.п.): заметки, иначе намёк по заголовку. */
export function libraryTaskDescriptionFromCard(item: LibraryItem): string {
  const notes = (item.notes || '').trim()
  if (notes) return notes
  const title = (item.title || '').trim()
  if (title) {
    return `Сгенерировать промпт для задачи в духе «${title}» (уточните исходные данные и цель).`
  }
  return libraryUserTurnFromCard(item)
}
