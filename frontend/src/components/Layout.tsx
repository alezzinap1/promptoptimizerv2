import { useCallback, useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { api, type Workspace } from '../api/client'
import { getRecentSessions, type RecentSession } from '../lib/recentSessions'
import { useAuth } from '../context/AuthContext'
import { useT } from '../i18n'
import AppSidebar from './AppSidebar'
import UserMenu from './UserMenu'
import LanguageSwitcher from './LanguageSwitcher'
import styles from './Layout.module.css'

const COLLAPSED_KEY = 'metaprompt-sidebar-collapsed'

const iconsUser = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
)

function loadSkillCount(): number {
  try {
    const raw = localStorage.getItem('prompt-engineer-skills-v1')
    const p = raw ? JSON.parse(raw) : []
    return Array.isArray(p) ? p.length : 0
  } catch {
    return 0
  }
}

function pickWorkspaceName(
  items: Workspace[],
  id: number,
  listReady: boolean,
  loadingLabel: string,
  fallbackTemplate: string,
): string | null {
  if (!id) return null
  const w = items.find((x) => Number(x.id ?? 0) === id)
  if (w?.name?.trim()) return w.name.trim()
  if (!listReady) return loadingLabel
  return fallbackTemplate.replace('{id}', String(id))
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const { t } = useT()
  const location = useLocation()
  const isWelcomePublic = location.pathname === '/welcome'

  const [collapsed, setCollapsed] = useState(() => typeof localStorage !== 'undefined' && localStorage.getItem(COLLAPSED_KEY) === '1')
  const [counts, setCounts] = useState<{ prompts: number | null; skills: number }>({
    prompts: null,
    skills: loadSkillCount(),
  })
  const [recent, setRecent] = useState<RecentSession[]>(() => (typeof window !== 'undefined' ? getRecentSessions() : []))
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspacesListReady, setWorkspacesListReady] = useState(false)
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(0)

  const showSidebar = !!user && !isWelcomePublic

  const refreshNavCounts = useCallback(() => {
    if (!user) return
    api
      .getLibraryStats()
      .then((s) => {
        setCounts({ prompts: s.total, skills: loadSkillCount() })
      })
      .catch(() => {
        setCounts((c) => ({
          prompts: c.prompts ?? 0,
          skills: loadSkillCount(),
        }))
      })
  }, [user])

  useEffect(() => {
    refreshNavCounts()
  }, [refreshNavCounts])

  useEffect(() => {
    const onRefresh = () => refreshNavCounts()
    window.addEventListener('metaprompt-nav-refresh', onRefresh)
    return () => window.removeEventListener('metaprompt-nav-refresh', onRefresh)
  }, [refreshNavCounts])

  useEffect(() => {
    const onRecent = () => setRecent(getRecentSessions())
    window.addEventListener('metaprompt-recent-sessions', onRecent)
    return () => window.removeEventListener('metaprompt-recent-sessions', onRecent)
  }, [])

  useEffect(() => {
    if (!user) return
    setWorkspacesListReady(false)
    api
      .getWorkspaces()
      .then((r) => {
        setWorkspaces(r.items)
        const wid = Number(localStorage.getItem('prompt-engineer-active-workspace') || 0)
        setActiveWorkspaceId(wid)
      })
      .catch(() => setWorkspaces([]))
      .finally(() => setWorkspacesListReady(true))
  }, [user])

  useEffect(() => {
    if (!user || !workspacesListReady || activeWorkspaceId <= 0) return
    const has = workspaces.some((w) => Number(w.id ?? 0) === activeWorkspaceId)
    if (has) return
    let cancelled = false
    api
      .getWorkspace(activeWorkspaceId)
      .then((r) => {
        if (cancelled) return
        setWorkspaces((prev) => {
          if (prev.some((w) => Number(w.id ?? 0) === activeWorkspaceId)) return prev
          return [...prev, r.item]
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user, workspacesListReady, activeWorkspaceId, workspaces])

  useEffect(() => {
    const onWs = (ev: Event) => {
      const id = (ev as CustomEvent<{ id: number }>).detail?.id ?? 0
      setActiveWorkspaceId(Number(id))
    }
    window.addEventListener('metaprompt-workspace', onWs as EventListener)
    return () => window.removeEventListener('metaprompt-workspace', onWs as EventListener)
  }, [])

  const toggleCollapse = () => {
    setCollapsed((v) => {
      const next = !v
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
      return next
    })
  }

  const workspaceLabel = showSidebar
    ? pickWorkspaceName(
        workspaces,
        activeWorkspaceId,
        workspacesListReady,
        t.header.workspaceLoading,
        t.header.workspaceFallback,
      )
    : null
  const isDemoUser = user?.username === 'demo_user'

  const logoWordmark = (
    <span className={styles.logoText}>
      <span className={styles.logoWordMeta}>meta</span>
      <span className={styles.logoWordPrompt}>prompt</span>
    </span>
  )

  if (isWelcomePublic && !user) {
    return (
      <div className={styles.publicShell}>
        <header className={styles.publicHeader}>
          <NavLink to="/welcome" className={styles.logo}>
            <span className={styles.logoGlyph} aria-hidden />
            {logoWordmark}
          </NavLink>
          <div className={styles.publicHeaderRight}>
            <LanguageSwitcher />
            <NavLink to="/login" className={styles.loginBtn}>
              {t.common.login}
            </NavLink>
          </div>
        </header>
        <main className={styles.publicMain}>{children}</main>
      </div>
    )
  }

  return (
    <div className={styles.app}>
      {showSidebar ? (
        <AppSidebar
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          counts={counts}
          recentSessions={recent}
          workspaceLabel={workspaceLabel}
          isAdmin={!!user?.is_admin}
        />
      ) : null}
      <div className={styles.shell}>
        {isDemoUser ? (
          <div className={styles.demoBanner} role="status">
            {t.header.demoBanner}{' '}
            <NavLink to="/login" className={styles.demoBannerLink}>
              {t.header.demoBannerLogin}
            </NavLink>
            {t.header.demoBannerTail}
          </div>
        ) : null}
        <div className={styles.headerWrap}>
          <header className={styles.header}>
            <div className={styles.headerLeft}>
              <NavLink to="/home" className={styles.logo} aria-label={t.header.logoAriaHome}>
                <span className={styles.logoGlyph} aria-hidden />
                {logoWordmark}
              </NavLink>
              {user ? (
                <div className={styles.modeSwitch} role="group" aria-label={t.header.modeStudio}>
                  <NavLink
                    to="/home"
                    className={({ isActive }) => `${styles.modeBtn} ${isActive ? styles.modeBtnActive : ''}`}
                  >
                    {t.header.modeStudio}
                  </NavLink>
                  <NavLink
                    to="/simple"
                    className={({ isActive }) => `${styles.modeBtn} ${isActive ? styles.modeBtnActive : ''}`}
                  >
                    {t.header.modeSimple}
                  </NavLink>
                </div>
              ) : null}
            </div>
            <div className={styles.controls}>
              <LanguageSwitcher />
              {user ? (
                <div className={styles.userBox}>
                  <div className={styles.userAvatar} aria-hidden>
                    {iconsUser}
                  </div>
                  <span className={styles.userName}>{user.username}</span>
                  <UserMenu />
                </div>
              ) : (
                <NavLink to="/login" className={styles.loginBtn}>
                  {t.common.login}
                </NavLink>
              )}
            </div>
          </header>
        </div>
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  )
}
