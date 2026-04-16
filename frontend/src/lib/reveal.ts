import { useEffect, useRef, useState } from 'react'

/*
 * useTypewriterReveal — progressive character reveal over a fixed
 * duration, regardless of text length.
 *
 * Design choices:
 *   - Fixed duration (default 600ms) instead of fixed per-char delay.
 *     A short blurb feels deliberate; a long prompt finishes fast.
 *   - Callers can skip() to show full text instantly (Esc, click).
 *   - Respects prefers-reduced-motion: returns the full text immediately.
 *   - Driven by rAF, not setInterval — smooth on 120Hz displays,
 *     pauses when the tab is hidden.
 *
 * Returns the currently-visible slice of the input plus a `done` flag
 * and a `skip()` helper. Re-runs whenever `text` or `key` changes.
 *
 * Usage:
 *   const { visible, done, skip } = useTypewriterReveal(result)
 *   return <pre onClick={skip}>{visible}</pre>
 */

export interface RevealOptions {
  /** Total duration of the reveal animation, in ms. */
  durationMs?: number
  /** Opt-out of the animation (renders full text immediately). */
  disabled?: boolean
  /**
   * Arbitrary key to force a restart even when `text` is reference-stable
   * (e.g. re-running the same generation with the same content).
   */
  resetKey?: string | number
}

export interface RevealState {
  visible: string
  done: boolean
  skip: () => void
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function useTypewriterReveal(
  text: string | null | undefined,
  options: RevealOptions = {},
): RevealState {
  const { durationMs = 600, disabled = false, resetKey } = options
  const safeText = text ?? ''

  const [visibleLen, setVisibleLen] = useState<number>(() =>
    disabled || prefersReducedMotion() ? safeText.length : 0,
  )
  const rafRef = useRef<number | null>(null)
  const skippedRef = useRef(false)

  useEffect(() => {
    if (!safeText) {
      setVisibleLen(0)
      return
    }
    if (disabled || prefersReducedMotion()) {
      setVisibleLen(safeText.length)
      return
    }

    skippedRef.current = false
    const start = performance.now()
    const total = safeText.length
    // At least a minimal duration so very short snippets still read as "reveal".
    const effectiveDuration = Math.max(180, durationMs)

    const tick = (now: number) => {
      if (skippedRef.current) return
      const elapsed = now - start
      const progress = Math.min(1, elapsed / effectiveDuration)
      // Smooth ease-out curve so the tail doesn't feel abrupt.
      const eased = 1 - Math.pow(1 - progress, 2)
      const next = Math.min(total, Math.max(1, Math.round(eased * total)))
      setVisibleLen(next)
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }

    setVisibleLen(Math.min(total, 1))
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [safeText, durationMs, disabled, resetKey])

  const skip = () => {
    skippedRef.current = true
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    setVisibleLen(safeText.length)
  }

  return {
    visible: safeText.slice(0, visibleLen),
    done: visibleLen >= safeText.length,
    skip,
  }
}
