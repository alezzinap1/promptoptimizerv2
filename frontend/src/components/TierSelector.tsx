import { useMemo } from 'react'
import SelectDropdown from './SelectDropdown'
import { useT } from '../i18n'

export type TierValue = 'auto' | 'fast' | 'mid' | 'advanced' | 'custom'

export const ALL_TIERS: TierValue[] = ['auto', 'fast', 'mid', 'advanced', 'custom']

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
  const { t } = useT()

  const options = useMemo(
    () =>
      ALL_TIERS.map((tier) => {
        const pack = t.tiersUi[tier]
        return {
          value: tier,
          label: pack.label,
          title: pack.hint,
        }
      }),
    [t],
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
        aria-label={t.studio.tierSelectAria}
        variant="composer"
        disabled={disabled}
        className={className}
      />
    )
  }

  return (
    <div
      role="radiogroup"
      aria-label={t.studio.tierRadiogroupAria}
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
      {ALL_TIERS.map((tier) => {
        const active = value === tier
        const pack = t.tiersUi[tier]
        return (
          <button
            key={tier}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            title={pack.hint}
            onClick={() => {
              if (disabled) return
              persistTier(tier)
              onChange(tier)
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
            {pack.label}
          </button>
        )
      })}
    </div>
  )
}
