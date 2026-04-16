import { useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import SelectDropdown from './SelectDropdown'

export type TierValue = 'auto' | 'fast' | 'mid' | 'advanced' | 'custom'

export const ALL_TIERS: TierValue[] = ['auto', 'fast', 'mid', 'advanced', 'custom']

const FALLBACK_LABELS: Record<TierValue, string> = {
  auto: 'Авто',
  fast: 'Повседневный',
  mid: 'Средний',
  advanced: 'Продвинутый',
  custom: 'Свой выбор',
}

const TIER_HINTS: Record<TierValue, string> = {
  auto: 'MetaPrompt сам подбирает модель под задачу',
  fast: 'Быстрый дешёвый ответ — повседневные задачи',
  mid: 'Баланс качества и цены',
  advanced: 'Глубже думает, использует вспомогательные модели — сложные задачи',
  custom: 'Вручную выбрать конкретную модель (нужен свой OpenRouter ключ для дорогих)',
}

const TIER_STORAGE_KEY = 'studio.tier.v1'

export function loadTier(): TierValue {
  if (typeof window === 'undefined') return 'auto'
  const saved = window.localStorage.getItem(TIER_STORAGE_KEY)
  if (saved && (ALL_TIERS as string[]).includes(saved)) return saved as TierValue
  return 'auto'
}

export function persistTier(tier: TierValue): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(TIER_STORAGE_KEY, tier)
}

type Props = {
  value: TierValue
  onChange: (tier: TierValue) => void
  disabled?: boolean
  compact?: boolean
  /** `dropdown` — как выбор модели (один компактный селект). `pills` — старая строка кнопок. */
  variant?: 'pills' | 'dropdown'
  className?: string
}

export default function TierSelector({
  value,
  onChange,
  disabled,
  compact: _compact,
  variant = 'dropdown',
  className = '',
}: Props) {
  const [labels, setLabels] = useState<Record<string, string>>(FALLBACK_LABELS)

  useEffect(() => {
    let cancelled = false
    api
      .getModelTiers()
      .then((r) => {
        if (cancelled) return
        const mapped: Record<string, string> = { ...FALLBACK_LABELS }
        for (const t of r.tiers) {
          mapped[t.id] = t.label
        }
        setLabels(mapped)
      })
      .catch(() => {
        /* fallback labels */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const options = useMemo(
    () =>
      ALL_TIERS.map((t) => ({
        value: t,
        label: labels[t] || FALLBACK_LABELS[t],
        title: TIER_HINTS[t],
      })),
    [labels],
  )

  if (variant === 'dropdown') {
    return (
      <SelectDropdown
        value={value}
        options={options}
        onChange={(v) => {
          persistTier(v as TierValue)
          onChange(v as TierValue)
        }}
        aria-label="Сложность генерации"
        variant="composer"
        disabled={disabled}
        className={className}
      />
    )
  }

  return (
    <div
      role="radiogroup"
      aria-label="Уровень сложности"
      style={{
        display: 'inline-flex',
        gap: 4,
        padding: 3,
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 999,
        background: 'rgba(255,255,255,0.02)',
        flexWrap: 'wrap',
      }}
    >
      {ALL_TIERS.map((t) => {
        const active = value === t
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            title={TIER_HINTS[t]}
            onClick={() => {
              if (disabled) return
              persistTier(t)
              onChange(t)
            }}
            style={{
              padding: _compact ? '3px 10px' : '5px 14px',
              border: 'none',
              borderRadius: 999,
              fontSize: _compact ? 11 : 12.5,
              fontWeight: active ? 600 : 500,
              background: active ? 'var(--color-text-primary, #fff)' : 'transparent',
              color: active ? 'var(--color-background-primary, #000)' : 'var(--color-text-secondary, #999)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              transition: 'background .12s, color .12s',
              opacity: disabled ? 0.55 : 1,
            }}
          >
            {labels[t] || FALLBACK_LABELS[t]}
          </button>
        )
      })}
    </div>
  )
}
