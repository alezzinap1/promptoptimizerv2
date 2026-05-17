import { useEffect } from 'react'

export type HotkeyCombo = {
  key: string
  meta?: boolean
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
}

function matchCombo(e: KeyboardEvent, combo: HotkeyCombo): boolean {
  const key = combo.key.toLowerCase()
  if (e.key.toLowerCase() !== key && e.code.toLowerCase() !== `key${key}`) return false
  const mod = e.metaKey || e.ctrlKey
  if (combo.meta && !mod) return false
  if (combo.ctrl && !e.ctrlKey) return false
  if (combo.shift && !e.shiftKey) return false
  if (combo.alt && !e.altKey) return false
  if (!combo.meta && !combo.ctrl && mod) return false
  if (!combo.shift && e.shiftKey) return false
  if (!combo.alt && e.altKey) return false
  return true
}

/** Register a global hotkey. Returns nothing; cleans up on unmount. */
export function useHotkey(
  combo: HotkeyCombo,
  handler: (e: KeyboardEvent) => void,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      if (matchCombo(e, combo)) {
        handler(e)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [combo, handler, enabled])
}

export function isModEnter(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && e.key === 'Enter'
}
