import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import styles from './ThemedTooltip.module.css'

type Side = 'top' | 'bottom' | 'left' | 'right'

type Props = {
  content: ReactNode
  children: ReactNode
  side?: Side
  /** Задержка перед показом, мс */
  delayMs?: number
  /** Не показывать (например, пока открыт родительский дропдаун) */
  disabled?: boolean
  className?: string
  /** На всю ширину родителя (пункты меню) */
  block?: boolean
}

const GAP = 8

export default function ThemedTooltip({
  content,
  children,
  side = 'top',
  delayMs = 380,
  disabled = false,
  className = '',
  block = false,
}: Props) {
  const id = useId()
  const wrapRef = useRef<HTMLElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [visible, setVisible] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const scheduleOpen = useCallback(() => {
    clearTimer()
    if (disabled || !content) return
    timerRef.current = setTimeout(() => {
      setOpen(true)
      timerRef.current = null
    }, delayMs)
  }, [clearTimer, delayMs, disabled, content])

  const close = useCallback(() => {
    clearTimer()
    setOpen(false)
    setVisible(false)
  }, [clearTimer])

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return
    const el = wrapRef.current
    const rect = el.getBoundingClientRect()
    const tip = tipRef.current
    const th = tip?.offsetHeight ?? 0
    const tw = tip?.offsetWidth ?? 220
    const pad = 8
    let top = rect.top + rect.height / 2 - th / 2
    let left = rect.left + rect.width / 2 - tw / 2
    if (side === 'top') {
      top = rect.top - GAP - th
      left = rect.left + rect.width / 2 - tw / 2
    } else if (side === 'bottom') {
      top = rect.bottom + GAP
      left = rect.left + rect.width / 2 - tw / 2
    } else if (side === 'left') {
      top = rect.top + rect.height / 2 - th / 2
      left = rect.left - GAP - tw
    } else if (side === 'right') {
      top = rect.top + rect.height / 2 - th / 2
      left = rect.right + GAP
    }
    left = Math.max(pad, Math.min(left, window.innerWidth - tw - pad))
    top = Math.max(pad, Math.min(top, window.innerHeight - th - pad))
    if (side === 'top' && top < pad) top = rect.bottom + GAP
    if (side === 'bottom' && top + th > window.innerHeight - pad) top = rect.top - GAP - th
    setCoords({ top, left })
    requestAnimationFrame(() => setVisible(true))
  }, [open, side, content])

  useEffect(() => {
    if (!open) return
    const onScroll = () => setOpen(false)
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [open])

  const tip = open ? (
    <div
      ref={tipRef}
      id={id}
      role="tooltip"
      className={`${styles.tip} ${visible ? styles.tipVisible : ''}`.trim()}
      style={{ top: coords.top, left: coords.left }}
    >
      <div className={styles.tipInner}>{content}</div>
    </div>
  ) : null

  const wrapClass = `${styles.wrap} ${block ? styles.wrapBlock : ''} ${className}`.trim()
  const portal = typeof document !== 'undefined' && tip ? createPortal(tip, document.body) : null

  return block ? (
    <div
      ref={wrapRef as RefObject<HTMLDivElement>}
      className={wrapClass}
      onMouseEnter={scheduleOpen}
      onMouseLeave={close}
      onFocus={scheduleOpen}
      onBlur={close}
    >
      {children}
      {portal}
    </div>
  ) : (
    <span
      ref={wrapRef as RefObject<HTMLSpanElement>}
      className={wrapClass}
      onMouseEnter={scheduleOpen}
      onMouseLeave={close}
      onFocus={scheduleOpen}
      onBlur={close}
    >
      {children}
      {portal}
    </span>
  )
}
