import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { api } from '../api/client'
import { useAuth } from './AuthContext'

const PALETTES = ['amber', 'obsidian', 'aurora', 'dune'] as const
const FONTS = ['plusjakarta', 'inter', 'dmsans', 'geist'] as const
const COLOR_MODES = ['dark', 'light'] as const

type PaletteId = (typeof PALETTES)[number]
type FontId = (typeof FONTS)[number]
type ColorMode = (typeof COLOR_MODES)[number]

const LEGACY_PALETTE_MAP: Record<string, PaletteId> = {
  slate: 'obsidian',
  forest: 'dune',
  midnight: 'obsidian',
  ocean: 'aurora',
  mono: 'obsidian',
  amber: 'amber',
  obsidian: 'obsidian',
  aurora: 'aurora',
  dune: 'dune',
}

const LEGACY_FONT_MAP: Record<string, FontId> = {
  plusjakarta: 'plusjakarta',
  inter: 'inter',
  dmsans: 'dmsans',
  geist: 'geist',
  ibmplex: 'inter',
  spacegrotesk: 'geist',
  manrope: 'inter',
  outfit: 'geist',
  jetbrains: 'plusjakarta',
  firacode: 'plusjakarta',
}

const STORAGE_KEY = 'prompt-engineer-prefs'

const FONT_STACKS: Record<FontId, string> = {
  plusjakarta: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif",
  inter: "'Inter', 'Plus Jakarta Sans', system-ui, sans-serif",
  dmsans: "'DM Sans', 'Plus Jakarta Sans', system-ui, sans-serif",
  /* npm-пакет geist тянет next/font; пока — тот же стек, метка «Geist» в настройках */
  geist: "'Inter', 'Plus Jakarta Sans', system-ui, sans-serif",
}

function normalizePalette(raw: string | undefined): PaletteId {
  const v = (raw || 'amber').toLowerCase()
  return LEGACY_PALETTE_MAP[v] || (PALETTES.includes(v as PaletteId) ? (v as PaletteId) : 'amber')
}

function normalizeFont(raw: string | undefined): FontId {
  const v = (raw || 'plusjakarta').toLowerCase()
  return LEGACY_FONT_MAP[v] || (FONTS.includes(v as FontId) ? (v as FontId) : 'plusjakarta')
}

function normalizeMode(raw: string | undefined): ColorMode {
  return raw === 'light' ? 'light' : 'dark'
}

function loadPrefs(): { palette: PaletteId; font: FontId; mode: ColorMode } {
  try {
    const s = localStorage.getItem(STORAGE_KEY)
    if (s) {
      const p = JSON.parse(s) as {
        palette?: string
        font?: string
        mode?: string
        theme?: string
      }
      let mode: ColorMode = 'dark'
      if (p.mode && COLOR_MODES.includes(p.mode as ColorMode)) {
        mode = p.mode as ColorMode
      } else if (p.theme === 'light') {
        mode = 'light'
      }
      let palette: PaletteId = 'amber'
      if (p.palette) {
        palette = normalizePalette(p.palette)
      } else if (p.theme && p.theme !== 'light') {
        palette = normalizePalette(p.theme)
      }
      const font = normalizeFont(p.font)
      return { palette, font, mode }
    }
  } catch {
    /* ignore */
  }
  return { palette: 'amber', font: 'plusjakarta', mode: 'light' }
}

function savePrefs(palette: PaletteId, font: FontId, mode: ColorMode) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ palette, font, mode }))
}

function applyDom(palette: PaletteId, mode: ColorMode, font: FontId) {
  const root = document.documentElement
  root.setAttribute('data-palette', palette)
  root.setAttribute('data-theme', mode)
  const stack = FONT_STACKS[font]
  root.style.setProperty('--font-ui', stack)
  root.style.setProperty('--font-display', stack)
  root.style.setProperty('--font', stack)
}

interface ThemeContextType {
  palette: PaletteId
  mode: ColorMode
  font: FontId
  theme: PaletteId
  setPalette: (p: PaletteId) => void
  setMode: (m: ColorMode) => void
  setTheme: (p: PaletteId) => void
  setFont: (f: FontId) => void
}

const ThemeContext = createContext<ThemeContextType | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [prefs, setPrefs] = useState(loadPrefs)
  const serverSyncedRef = useRef(false)

  useEffect(() => {
    serverSyncedRef.current = false
  }, [user?.id])

  useEffect(() => {
    applyDom(prefs.palette, prefs.mode, prefs.font)
  }, [prefs.palette, prefs.mode, prefs.font])

  /** Подгрузка DM Sans при смене шрифта (не в main — меньше начальный бандл для остальных). */
  useEffect(() => {
    if (prefs.font !== 'dmsans') return
    void import('@fontsource-variable/dm-sans/wght.css')
  }, [prefs.font])

  const pushServer = useCallback(
    async (palette: PaletteId, font: FontId, mode: ColorMode) => {
      if (!user || user.id === 0) return
      try {
        await api.updateSettings({
          theme: palette,
          font,
          color_mode: mode,
        })
      } catch {
        /* offline — локальные prefs остаются */
      }
    },
    [user],
  )

  useEffect(() => {
    if (!user || user.id === 0) {
      serverSyncedRef.current = false
      return
    }
    if (serverSyncedRef.current) return
    serverSyncedRef.current = true
    api
      .getSettings()
      .then((s) => {
        const palette = normalizePalette(s.theme)
        const font = normalizeFont(s.font)
        const mode = normalizeMode(s.color_mode)
        setPrefs({ palette, font, mode })
        savePrefs(palette, font, mode)
        applyDom(palette, mode, font)
      })
      .catch(() => {
        serverSyncedRef.current = false
      })
  }, [user?.id])

  const setPalette = (p: PaletteId) => {
    setPrefs((prev) => {
      savePrefs(p, prev.font, prev.mode)
      void pushServer(p, prev.font, prev.mode)
      return { ...prev, palette: p }
    })
  }

  const setMode = (m: ColorMode) => {
    setPrefs((prev) => {
      savePrefs(prev.palette, prev.font, m)
      void pushServer(prev.palette, prev.font, m)
      return { ...prev, mode: m }
    })
  }

  const setFont = (f: FontId) => {
    setPrefs((prev) => {
      savePrefs(prev.palette, f, prev.mode)
      void pushServer(prev.palette, f, prev.mode)
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

/** @deprecated use PALETTES */
const THEMES = PALETTES
export { THEMES, PALETTES, FONTS, COLOR_MODES }
export type { PaletteId, FontId, ColorMode }
