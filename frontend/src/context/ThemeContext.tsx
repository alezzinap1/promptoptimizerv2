import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

const PALETTES = ['slate', 'forest', 'midnight', 'amber', 'ocean', 'mono'] as const
const FONTS = ['jetbrains', 'inter', 'ibmplex', 'plusjakarta', 'spacegrotesk', 'manrope', 'outfit', 'firacode'] as const
const COLOR_MODES = ['dark', 'light'] as const

type PaletteId = (typeof PALETTES)[number]
type FontId = (typeof FONTS)[number]
type ColorMode = (typeof COLOR_MODES)[number]

// Keep THEMES as alias for backward compat (used in Settings.tsx select)
const THEMES = PALETTES

interface ThemeContextType {
  palette: PaletteId
  mode: ColorMode
  font: FontId
  // Legacy alias — some pages may still reference `theme`
  theme: PaletteId
  setPalette: (p: PaletteId) => void
  setMode: (m: ColorMode) => void
  setTheme: (p: PaletteId) => void
  setFont: (f: FontId) => void
}

const ThemeContext = createContext<ThemeContextType | null>(null)

const STORAGE_KEY = 'prompt-engineer-prefs'
const FONT_STACKS: Record<FontId, string> = {
  jetbrains: "'JetBrains Mono', monospace",
  inter: "'Inter', system-ui, sans-serif",
  ibmplex: "'IBM Plex Sans', system-ui, sans-serif",
  plusjakarta: "'Plus Jakarta Sans', system-ui, sans-serif",
  spacegrotesk: "'Space Grotesk', system-ui, sans-serif",
  manrope: "'Manrope', system-ui, sans-serif",
  outfit: "'Outfit', system-ui, sans-serif",
  firacode: "'Fira Code', monospace",
}

function loadPrefs(): { palette: PaletteId; font: FontId; mode: ColorMode } {
  try {
    const s = localStorage.getItem(STORAGE_KEY)
    if (s) {
      const p = JSON.parse(s)

      // Migrate legacy `theme` field
      let palette: PaletteId = 'slate'
      let mode: ColorMode = 'dark'

      if (p.palette && PALETTES.includes(p.palette as PaletteId)) {
        palette = p.palette as PaletteId
      } else if (p.theme) {
        // Legacy: 'light' theme → slate palette + light mode
        if (p.theme === 'light') {
          palette = 'slate'
          mode = 'light'
        } else if (PALETTES.includes(p.theme as PaletteId)) {
          palette = p.theme as PaletteId
        }
      }

      if (p.mode && COLOR_MODES.includes(p.mode as ColorMode)) {
        mode = p.mode as ColorMode
      }

      const font: FontId = FONTS.includes(p.font as FontId) ? (p.font as FontId) : 'jetbrains'
      return { palette, font, mode }
    }
  } catch {}
  return { palette: 'slate', font: 'jetbrains', mode: 'dark' }
}

function savePrefs(palette: PaletteId, font: FontId, mode: ColorMode) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ palette, font, mode }))
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState(loadPrefs)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', prefs.palette)
    document.documentElement.setAttribute('data-mode', prefs.mode)
    document.body.style.fontFamily = FONT_STACKS[prefs.font]
  }, [prefs.palette, prefs.mode, prefs.font])

  const setPalette = (p: PaletteId) => {
    setPrefs((prev) => {
      savePrefs(p, prev.font, prev.mode)
      return { ...prev, palette: p }
    })
  }

  const setMode = (m: ColorMode) => {
    setPrefs((prev) => {
      savePrefs(prev.palette, prev.font, m)
      return { ...prev, mode: m }
    })
  }

  const setFont = (f: FontId) => {
    setPrefs((prev) => {
      savePrefs(prev.palette, f, prev.mode)
      return { ...prev, font: f }
    })
  }

  const value: ThemeContextType = {
    palette: prefs.palette,
    mode: prefs.mode,
    font: prefs.font,
    theme: prefs.palette,
    setPalette,
    setMode,
    setTheme: setPalette,
    setFont,
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

export { THEMES, PALETTES, FONTS, COLOR_MODES }
export type { PaletteId, FontId, ColorMode }
