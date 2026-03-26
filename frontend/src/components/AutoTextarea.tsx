import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows'> & {
  /** Минимальная высота поля в px (пустое состояние / одна-две строки) */
  minHeightPx?: number
  /** После этой высоты включается прокрутка внутри поля */
  maxHeightPx?: number
}

/**
 * Текстовое поле без ручного resize: высота подстраивается под текст (как в Claude).
 */
export default function AutoTextarea({
  className,
  minHeightPx = 72,
  maxHeightPx = 360,
  value,
  onChange,
  style,
  ...rest
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    const sh = el.scrollHeight
    const next = Math.max(minHeightPx, Math.min(sh, maxHeightPx))
    el.style.height = `${next}px`
    el.style.overflowY = sh > maxHeightPx ? 'auto' : 'hidden'
  }, [value, minHeightPx, maxHeightPx])

  return (
    <textarea
      ref={ref}
      rows={1}
      {...rest}
      className={className}
      value={value}
      onChange={onChange}
      style={{
        resize: 'none',
        minHeight: minHeightPx,
        ...style,
      }}
    />
  )
}
