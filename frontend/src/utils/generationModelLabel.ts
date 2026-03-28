/** Укорачивает подпись модели: убирает префикс провайдера до первого «:». */
export function shortGenerationModelLabel(full: string): string {
  const t = full.trim()
  const i = t.indexOf(':')
  if (i === -1) return t
  const rest = t.slice(i + 1).trim()
  return rest || t
}
