import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import MarkdownOutput from '../components/MarkdownOutput'

/** Единые параметры имитации стриминга для всех ответов LLM в UI. */
export const LLM_STREAM_DELAY_MS_MIN = 3
/** Случайная добавка [0, SPAN−1] → итоговая задержка 3…14 ms. */
export const LLM_STREAM_DELAY_MS_SPAN = 12

export const LLM_STREAM_CHUNK_MIN = 3
/** Случайная добавка [0, SPAN−1] → размер куска 3…40 символов. */
export const LLM_STREAM_CHUNK_SPAN = 38

export function nextLlmStreamDelayMs(): number {
  return LLM_STREAM_DELAY_MS_MIN + Math.floor(Math.random() * LLM_STREAM_DELAY_MS_SPAN)
}

export function nextLlmStreamChunkSize(): number {
  return LLM_STREAM_CHUNK_MIN + Math.floor(Math.random() * LLM_STREAM_CHUNK_SPAN)
}

export type SimulatedLlmStreamOptions = {
  suspend: boolean
  /** Вызывается, когда доиграна анимация до полного текста (не при suspend / reduced-motion мгновенном показе). */
  onStreamComplete?: () => void
}

/**
 * @param suspend — если true, сразу показываем полный `sourceText` (ожидание запроса, пользовательский текст).
 */
export function useSimulatedLlmStream(sourceText: string, options: SimulatedLlmStreamOptions): string {
  const [out, setOut] = useState('')
  const onCompleteRef = useRef(options.onStreamComplete)
  onCompleteRef.current = options.onStreamComplete

  useLayoutEffect(() => {
    if (options.suspend) {
      setOut(sourceText)
    }
  }, [options.suspend, sourceText])

  useEffect(() => {
    const timerIds: number[] = []
    let rafId: number | null = null
    const clearTimers = () => {
      timerIds.forEach((id) => window.clearTimeout(id))
      timerIds.length = 0
      if (rafId != null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
    }

    if (options.suspend) {
      return () => clearTimers()
    }

    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    ) {
      setOut(sourceText)
      if (sourceText) onCompleteRef.current?.()
      return () => clearTimers()
    }

    const full = sourceText
    if (!full) {
      setOut('')
      return () => clearTimers()
    }

    let cancelled = false

    const runChunkAnim = (from: number, to: number, animMs: number, onDone: () => void) => {
      if (to <= from) {
        onDone()
        return
      }
      const start = performance.now()
      const frame = (now: number) => {
        if (cancelled) return
        const t = animMs <= 0 ? 1 : Math.min(1, (now - start) / animMs)
        const eased = t * t * (3 - 2 * t)
        const cur = Math.round(from + (to - from) * eased)
        setOut(full.slice(0, cur))
        if (t < 1) {
          rafId = requestAnimationFrame(frame)
        } else {
          rafId = null
          setOut(full.slice(0, to))
          onDone()
        }
      }
      rafId = requestAnimationFrame(frame)
    }

    let pos = 0

    const step = () => {
      if (cancelled) return
      if (pos >= full.length) {
        setOut(full)
        onCompleteRef.current?.()
        return
      }
      const chunk = nextLlmStreamChunkSize()
      const nextPos = Math.min(full.length, pos + chunk)
      const from = pos
      const to = nextPos
      pos = nextPos
      const baseDelay = nextLlmStreamDelayMs()
      const animMs = Math.min(56, baseDelay * 0.85, Math.max(12, (to - from) * 3))
      const restDelay = Math.max(0, Math.round(baseDelay - animMs))

      runChunkAnim(from, to, animMs, () => {
        if (cancelled) return
        if (pos >= full.length) {
          setOut(full)
          onCompleteRef.current?.()
        } else {
          timerIds.push(window.setTimeout(step, restDelay))
        }
      })
    }

    const first = Math.min(nextLlmStreamChunkSize(), full.length)
    const baseDelay0 = nextLlmStreamDelayMs()
    const animMs0 = Math.min(56, baseDelay0 * 0.85, Math.max(12, first * 3))
    const rest0 = Math.max(0, Math.round(baseDelay0 - animMs0))
    pos = first

    runChunkAnim(0, first, animMs0, () => {
      if (cancelled) return
      if (pos >= full.length) {
        setOut(full)
        onCompleteRef.current?.()
      } else {
        timerIds.push(window.setTimeout(step, rest0))
      }
    })

    return () => {
      cancelled = true
      clearTimers()
    }
  }, [sourceText, options.suspend])

  return out
}

type StreamedMdProps = {
  source: string
  suspend: boolean
  onStreamComplete?: () => void
  className?: string
}

export function StreamedMarkdownOutput({ source, suspend, onStreamComplete, className }: StreamedMdProps) {
  const text = useSimulatedLlmStream(source, { suspend, onStreamComplete })
  return <MarkdownOutput className={className}>{text}</MarkdownOutput>
}
