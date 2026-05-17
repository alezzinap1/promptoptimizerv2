/** Props for responsive cover/hero images (library, community). */
export function coverImageSizes(columnLayout: 'full' | 'third' = 'third'): string {
  return columnLayout === 'full' ? '100vw' : '(max-width: 767px) 100vw, (max-width: 1439px) 50vw, 33vw'
}

export type CoverImageAttrs = {
  src: string
  sizes: string
  decoding: 'async'
  loading: 'lazy'
  fetchPriority?: 'low' | 'high' | 'auto'
}

/** Single-URL covers: sizes hint for layout; srcset when multiple widths exist later. */
export function coverImageAttrs(src: string, columnLayout: 'full' | 'third' = 'third'): CoverImageAttrs | null {
  const trimmed = src.trim()
  if (!trimmed) return null
  return {
    src: trimmed,
    sizes: coverImageSizes(columnLayout),
    decoding: 'async',
    loading: 'lazy',
    fetchPriority: 'low',
  }
}
