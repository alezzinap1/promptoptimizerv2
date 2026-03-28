/** Подпись к карточке: дата создания и (если отличалась) обновления. */
export function formatLibraryCardDates(createdAt: string, updatedAt: string): string {
  const c = new Date(createdAt)
  const u = new Date(updatedAt)
  if (Number.isNaN(c.getTime())) return ''

  const dtf = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' })
  const createdLabel = `Создан ${dtf.format(c)}`

  if (Number.isNaN(u.getTime()) || u.getTime() <= c.getTime() + 60_000) {
    return createdLabel
  }

  const daysAgo = Math.floor((Date.now() - u.getTime()) / 86_400_000)
  let updatedPart: string
  if (daysAgo <= 0) {
    updatedPart = 'обновлён сегодня'
  } else if (daysAgo === 1) {
    updatedPart = 'обновлён вчера'
  } else if (daysAgo <= 6) {
    updatedPart = `обновлён ${daysAgo} дн. назад`
  } else {
    updatedPart = `обновлён ${dtf.format(u)}`
  }

  return `${createdLabel} · ${updatedPart}`
}
