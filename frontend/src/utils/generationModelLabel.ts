function titleCaseSegment(s: string): string {
  return s
    .split(/[-_]/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ''))
    .join(' ')
}

/** Укорачивает подпись модели: убирает префикс провайдера до первого «:»; для `google/foo-bar` — человекочитаемо. */
export function shortGenerationModelLabel(full: string): string {
  const t = full.trim()
  const colon = t.indexOf(':')
  if (colon !== -1) {
    const rest = t.slice(colon + 1).trim()
    return rest || t
  }
  const slash = t.indexOf('/')
  if (slash !== -1 && slash < t.length - 1) {
    const tail = t.slice(slash + 1).trim()
    return titleCaseSegment(tail) || t
  }
  return t
}
