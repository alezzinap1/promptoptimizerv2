import type { ReactNode } from 'react'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import menuStyles from './DropdownMenu.module.css'
import PortalDropdown from './PortalDropdown'
import styles from './SelectDropdown.module.css'
import ThemedTooltip from './ThemedTooltip'

export type SelectOption = {
  value: string
  label: string
  title?: string
}

const Chevron = () => (
  <svg className={styles.chevron} width="12" height="12" viewBox="0 0 12 12" aria-hidden>
    <path fill="currentColor" d="M3 4.5 9 4.5 6 8z" />
  </svg>
)

type Props = {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  'aria-label': string
  /** Визуальный вариант кнопки-триггера */
  variant?: 'composer' | 'toolbar' | 'field'
  /** Доп. class на корневой wrap */
  className?: string
  disabled?: boolean
  /** Ссылка внизу меню (разделитель + пункт), например каталог моделей */
  footerLink?: { to: string; label: string }
  /** Заменить текст на кнопке (иконка и т.д.), подпись остаётся в title */
  triggerContent?: ReactNode
  /** Доп. class на кнопку-триггер */
  triggerClassName?: string
}

export default function SelectDropdown({
  value,
  options,
  onChange,
  'aria-label': ariaLabel,
  variant = 'composer',
  className = '',
  disabled = false,
  footerLink,
  triggerContent,
  triggerClassName = '',
}: Props) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const selected = options.find((o) => o.value === value)
  const triggerVariant =
    variant === 'toolbar' ? styles.triggerToolbar : variant === 'field' ? styles.triggerField : styles.triggerComposer

  const tip = selected?.title || selected?.label || ariaLabel

  return (
    <div className={`${styles.wrap} ${className}`.trim()}>
      <ThemedTooltip content={tip} side="bottom" disabled={open || disabled}>
        <button
          ref={btnRef}
          type="button"
          disabled={disabled}
          className={`${styles.trigger} ${triggerVariant} ${triggerClassName}`.trim()}
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={() => !disabled && setOpen((v) => !v)}
        >
          <span className={styles.triggerLabel}>
            {triggerContent ?? (selected?.label ?? (options.length ? '—' : 'Нет моделей'))}
          </span>
          <Chevron />
        </button>
      </ThemedTooltip>
      <PortalDropdown open={open} onClose={() => setOpen(false)} anchorRef={btnRef} minWidth={220} align="left">
        {options.map((opt) => (
          <ThemedTooltip
            key={opt.value}
            content={opt.title || opt.label}
            side="left"
            delayMs={220}
            block
          >
            <button
              type="button"
              role="option"
              aria-selected={opt.value === value}
              className={`${menuStyles.menuItem} ${opt.value === value ? menuStyles.menuItemActive : ''}`}
              onClick={() => {
                onChange(opt.value)
                setOpen(false)
              }}
            >
              {opt.label}
            </button>
          </ThemedTooltip>
        ))}
        {footerLink ? (
          <>
            <div className={menuStyles.menuDivider} />
            <Link
              to={footerLink.to}
              className={`${menuStyles.menuItem} ${menuStyles.menuAddLink}`}
              onClick={() => setOpen(false)}
            >
              {footerLink.label}
            </Link>
          </>
        ) : null}
      </PortalDropdown>
    </div>
  )
}
