import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useT } from '../i18n'
import { getRecentSessions, type RecentSession } from '../lib/recentSessions'
import styles from './CommandPalette.module.css'

/*
 * Global ⌘K / Ctrl+K command palette.
 * - Opens on ⌘K / Ctrl+K anywhere (unless already typing in the palette).
 * - Esc closes; ↑/↓ move; Enter executes; plain text filters.
 * - Theme commands are hidden in the marketing register (cream surface
 *   intentionally overrides user theme — see marketing-register.css).
 * - Palette itself is always mounted; action list adapts to auth state.
 * Spec: docs/superpowers/specs/2026-04-16-product-ux-visual-design.md §9.1.
 */

interface Command {
  id: string
  group: 'navigate' | 'actions' | 'recent' | 'admin'
  label: string
  /** Extra text that counts for filtering but isn't shown. */
  keywords?: string
  run: () => void
}

const RECENT_LIMIT = 6

export default function CommandPalette() {
  const { t, setLang, lang } = useT()
  const { user, logout } = useAuth()
  const { mode, setMode } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [recent, setRecent] = useState<RecentSession[]>([])

  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const isMarketingRoute = useMemo(() => {
    if (typeof document === 'undefined') return false
    return document.body.classList.contains('register-marketing')
  }, [location.pathname, open])

  const loadRecent = useCallback(() => {
    try {
      setRecent(getRecentSessions().slice(0, RECENT_LIMIT))
    } catch {
      setRecent([])
    }
  }, [])

  useEffect(() => {
    if (open) loadRecent()
  }, [open, loadRecent])

  // Global ⌘K / Ctrl+K shortcut. Suppressed only while the palette input
  // itself has focus (so users can still type the literal "k" there).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setOpen((prev) => !prev)
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Reset filter + focus input on open; restore body scroll on close.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusT = window.setTimeout(() => inputRef.current?.focus(), 10)
    return () => {
      clearTimeout(focusT)
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  const close = useCallback(() => setOpen(false), [])

  const runAndClose = useCallback(
    (fn: () => void) => {
      fn()
      close()
    },
    [close],
  )

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = []
    const cmd = t.palette.cmd

    if (user) {
      list.push(
        { id: 'go-studio', group: 'navigate', label: cmd.goStudio, keywords: 'home studio prompt', run: () => navigate('/home') },
        { id: 'go-simple', group: 'navigate', label: cmd.goSimple, keywords: 'simple improve edit', run: () => navigate('/simple') },
        { id: 'go-compare', group: 'navigate', label: cmd.goCompare, keywords: 'compare ab a/b judge', run: () => navigate('/compare') },
        { id: 'go-library', group: 'navigate', label: cmd.goLibrary, keywords: 'library prompts techniques saved', run: () => navigate('/library') },
        { id: 'go-community', group: 'navigate', label: cmd.goCommunity, keywords: 'community shared public', run: () => navigate('/community') },
        { id: 'go-models', group: 'navigate', label: cmd.goModels, keywords: 'models openrouter tier', run: () => navigate('/models') },
        { id: 'go-workspaces', group: 'navigate', label: cmd.goWorkspaces, keywords: 'workspace team', run: () => navigate('/workspaces') },
        { id: 'go-presets', group: 'navigate', label: cmd.goPresets, keywords: 'presets templates', run: () => navigate('/presets') },
        { id: 'go-settings', group: 'navigate', label: cmd.goSettings, keywords: 'settings api key', run: () => navigate('/settings') },
        { id: 'go-userinfo', group: 'navigate', label: cmd.goUserInfo, keywords: 'profile metrics usage tokens', run: () => navigate('/user-info') },
        { id: 'go-help', group: 'navigate', label: cmd.goHelp, keywords: 'help docs faq', run: () => navigate('/help') },
      )
      if (user.is_admin) {
        list.push({
          id: 'go-admin',
          group: 'admin',
          label: cmd.goAdmin,
          keywords: 'admin metrics model health users',
          run: () => navigate('/admin'),
        })
      }
    }

    // Theme toggle is intentionally absent in the marketing register:
    // spec §4.1 — cream surface overrides user theme on /welcome,/login,/onboarding.
    if (user && !isMarketingRoute) {
      list.push({
        id: 'theme-toggle',
        group: 'actions',
        label: mode === 'dark' ? cmd.themeLight : cmd.themeDark,
        keywords: 'theme dark light appearance',
        run: () => setMode(mode === 'dark' ? 'light' : 'dark'),
      })
    }

    list.push({
      id: 'lang-toggle',
      group: 'actions',
      label: lang === 'ru' ? cmd.langEn : cmd.langRu,
      keywords: 'language locale russian english язык',
      run: () => setLang(lang === 'ru' ? 'en' : 'ru'),
    })

    if (user) {
      list.push({
        id: 'sign-out',
        group: 'actions',
        label: cmd.signOut,
        keywords: 'logout signout exit',
        run: () => {
          void logout()
        },
      })
    } else {
      list.push({
        id: 'sign-in',
        group: 'actions',
        label: cmd.signIn,
        keywords: 'login signin',
        run: () => navigate('/login'),
      })
    }

    for (const r of recent) {
      list.push({
        id: `recent-${r.sessionId}`,
        group: 'recent',
        label: t.palette.sessionPrefix + (r.label || r.sessionId),
        keywords: r.sessionId,
        run: () => navigate(`/home?session=${encodeURIComponent(r.sessionId)}`),
      })
    }

    return list
  }, [t, user, isMarketingRoute, mode, lang, recent, navigate, setLang, setMode, logout])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((c) => {
      const hay = `${c.label} ${c.keywords ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [commands, query])

  // Keep activeIndex in range when the filtered list shrinks.
  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(0)
  }, [filtered.length, activeIndex])

  // Group ordering for rendering; groups with no matches disappear.
  const grouped = useMemo(() => {
    const order: Command['group'][] = ['recent', 'navigate', 'admin', 'actions']
    return order
      .map((g) => ({ group: g, items: filtered.filter((c) => c.group === g) }))
      .filter((bucket) => bucket.items.length > 0)
  }, [filtered])

  // Flat index map: activeIndex points into `filtered`, but we need to
  // scroll the right rendered row into view.
  const flatOrder = useMemo(() => grouped.flatMap((b) => b.items), [grouped])

  useEffect(() => {
    const item = listRef.current?.querySelector<HTMLElement>(
      `[data-cp-idx="${activeIndex}"]`,
    )
    item?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, grouped])

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(flatOrder.length - 1, i + 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(0, i - 1))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const pick = flatOrder[activeIndex]
      if (pick) runAndClose(pick.run)
    }
  }

  if (!open) return null

  const groupLabel = (g: Command['group']) => {
    if (g === 'navigate') return t.palette.groups.navigate
    if (g === 'actions') return t.palette.groups.actions
    if (g === 'recent') return t.palette.groups.recent
    return t.palette.groups.admin
  }

  let runningIdx = 0
  return (
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={t.palette.open}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className={styles.panel}>
        <div className={styles.searchRow}>
          <input
            ref={inputRef}
            className={styles.search}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActiveIndex(0)
            }}
            onKeyDown={onInputKey}
            placeholder={t.palette.placeholder}
            autoComplete="off"
            spellCheck={false}
          />
          <span className={styles.hintKbd} aria-hidden>
            esc
          </span>
        </div>

        <div ref={listRef} className={styles.list}>
          {grouped.length === 0 ? (
            <div className={styles.empty}>{t.palette.empty}</div>
          ) : (
            grouped.map((bucket) => (
              <div key={bucket.group} className={styles.group}>
                <div className={styles.groupLabel}>{groupLabel(bucket.group)}</div>
                {bucket.items.map((item) => {
                  const idx = runningIdx++
                  const active = idx === activeIndex
                  return (
                    <button
                      type="button"
                      key={item.id}
                      data-cp-idx={idx}
                      className={`${styles.item} ${active ? styles.itemActive : ''}`}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => runAndClose(item.run)}
                    >
                      <span className={styles.itemLabel}>{item.label}</span>
                      {active ? (
                        <span className={styles.itemHint} aria-hidden>
                          ↵
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
