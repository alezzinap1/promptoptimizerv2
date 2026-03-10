import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

const THEMES = ['slate', 'forest', 'light', 'midnight', 'amber', 'ocean'] as const
const FONTS = ['jetbrains', 'inter', 'ibmplex', 'plusjakarta', 'spacegrotesk', 'manrope', 'outfit', 'firacode'] as const

type ThemeId = (typeof THEMES)[number]
type FontId = (typeof FONTS)[number]

interface ThemeContextType {
  theme: ThemeId
  font: FontId
  setTheme: (t: ThemeId) => void
  setFont: (f: FontId) => void
}

const ThemeContext = createContext<ThemeContextType | null>(null)

const STORAGE_KEY = 'prompt-engineer-prefs'

function loadPrefs(): { theme: ThemeId; font: FontId } {
  try {
    const s = localStorage.getItem(STORAGE_KEY)
    if (s) {
      const p = JSON.parse(s)
      if (THEMES.includes(p.theme as ThemeId) && FONTS.includes(p.font as FontId)) {
        return { theme: p.theme, font: p.font }
      }
    }
  } catch {}
  return { theme: 'slate', font: 'jetbrains' }
}

function savePrefs(theme: ThemeId, font: FontId) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme, font }))
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState(loadPrefs)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', prefs.theme)
    document.body.style.fontFamily = prefs.font === 'jetbrains'
      ? "'JetBrains Mono', monospace"
      : prefs.font === 'inter'
      ? "'Inter', system-ui, sans-serif"
      : "'JetBrains Mono', monospace"
  }, [prefs.theme, prefs.font])

  const setTheme = (t: ThemeId) => {
    setPrefs((p) => ({ ...p, theme: t }))
    savePrefs(t, prefs.font)
  }
  const setFont = (f: FontId) => {
    setPrefs((p) => ({ ...p, font: f }))
    savePrefs(prefs.theme, f)
  }

  return (
    <ThemeContext.Provider value={{ ...prefs, setTheme, setFont }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}

export { THEMES, FONTS }
export type { ThemeId, FontId }
