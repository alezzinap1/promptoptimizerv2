import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import ru, { type Dict } from './ru'
import en from './en'

/*
 * Lightweight i18n. No external deps, no ICU.
 *
 * Consumer pattern:
 *   const { t, lang, setLang } = useT()
 *   <h1>{t.landing.hero.titleHead}</h1>
 *
 * The dict is typed (`Dict = typeof ru`), so missing keys surface at
 * compile time. Works with arrays — callers just .map() over them.
 *
 * Lang is persisted in localStorage and defaults to RU to match the
 * current audience; if the browser clearly requests EN, we honor it.
 */

const LANGS = ['ru', 'en'] as const
export type Lang = (typeof LANGS)[number]

const DICTS: Record<Lang, Dict> = { ru, en }

const STORAGE_KEY = 'metaprompt-lang'

function detectLang(): Lang {
  if (typeof window === 'undefined') return 'ru'
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'ru' || stored === 'en') return stored
  } catch {
    /* localStorage might be blocked; fall through */
  }
  const nav = (navigator.language || '').toLowerCase()
  if (nav.startsWith('en')) return 'en'
  return 'ru'
}

interface LanguageContextValue {
  lang: Lang
  setLang: (l: Lang) => void
  t: Dict
  langs: readonly Lang[]
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang)

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('lang', lang)
    }
  }, [lang])

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      /* non-fatal */
    }
  }, [])

  const value = useMemo<LanguageContextValue>(
    () => ({ lang, setLang, t: DICTS[lang], langs: LANGS }),
    [lang, setLang],
  )

  return (
    <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  )
}

export function useT(): LanguageContextValue {
  const ctx = useContext(LanguageContext)
  if (!ctx) {
    throw new Error('useT must be used within <LanguageProvider>')
  }
  return ctx
}

export type { Dict }
