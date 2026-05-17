import { useEffect, useState } from 'react'

export type TypewriterRevealOptions = {
  /** After this many ms of typing, append the rest instantly. */
  fastAfterMs?: number
  /** Approximate ms per character during the fast phase. */
  charMs?: number
}

/**
 * Typewriter reveal for full responses (spec §7.3).
 * First ~500ms types at ~8ms/char, then shows the remainder at once.
 */
export function useTypewriterReveal(
  text: string,
  active: boolean,
  opts?: TypewriterRevealOptions,
): string {
  const fastAfterMs = opts?.fastAfterMs ?? 500
  const charMs = opts?.charMs ?? 8
  const [shown, setShown] = useState('')

  useEffect(() => {
    if (!active || !text) {
      setShown(text)
      return
    }
    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    ) {
      setShown(text)
      return
    }

    setShown('')
    let i = 0
    const start = performance.now()
    let timer: number

    const tick = () => {
      const elapsed = performance.now() - start
      if (elapsed >= fastAfterMs) {
        setShown(text)
        return
      }
      const targetLen = Math.min(text.length, Math.floor(elapsed / charMs) + 1)
      if (targetLen > i) {
        i = targetLen
        setShown(text.slice(0, i))
      }
      if (i < text.length) {
        timer = window.setTimeout(tick, charMs)
      }
    }
    timer = window.setTimeout(tick, charMs)
    return () => window.clearTimeout(timer)
  }, [text, active, fastAfterMs, charMs])

  return shown
}
