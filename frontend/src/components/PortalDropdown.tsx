import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import styles from './DropdownMenu.module.css'

type Props = {
  open: boolean
  onClose: () => void
  anchorRef: RefObject<HTMLElement | null>
  children: ReactNode
  /** Минимальная ширина меню (и подсказка для первого кадра позиционирования) */
  minWidth?: number
  align?: 'left' | 'right'
  /** Дополнительный класс к панели (размер, фон) */
  panelClassName?: string
}

/**
 * Выпадающая панель в portal, чтобы не обрезалась родителем с overflow:hidden.
 */
export default function PortalDropdown({
  open,
  onClose,
  anchorRef,
  children,
  minWidth = 200,
  align = 'left',
  panelClassName,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({})

  useLayoutEffect(() => {
    if (!open) return

    const update = () => {
      const a = anchorRef.current
      const panel = panelRef.current
      if (!a) return
      const r = a.getBoundingClientRect()
      const vw = window.innerWidth
      const vh = window.innerHeight
      const pad = 8
      const gap = 6
      const w = Math.max(r.width, minWidth)
      let left = align === 'right' ? r.right - w : r.left
      if (left + w > vw - pad) left = vw - w - pad
      if (left < pad) left = pad

      const estH = panel?.offsetHeight || Math.min(280, vh * 0.4)
      let top = r.bottom + gap
      if (top + estH > vh - pad && r.top > estH + gap + pad) {
        top = r.top - estH - gap
      }
      if (top < pad) top = pad

      setStyle({
        position: 'fixed',
        top,
        left,
        minWidth: w,
        zIndex: 10000,
      })
    }

    update()
    const raf = requestAnimationFrame(update)
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, anchorRef, align, minWidth])

  useLayoutEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (anchorRef.current?.contains(t)) return
      if (panelRef.current?.contains(t)) return
      onClose()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, onClose, anchorRef])

  if (!open) return null

  return createPortal(
    <div
      ref={panelRef}
      className={[styles.dropdownPanel, panelClassName].filter(Boolean).join(' ')}
      style={style}
      role="listbox"
    >
      {children}
    </div>,
    document.body,
  )
}
