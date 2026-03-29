import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import type { RecentSession } from '../lib/recentSessions'
import styles from './AppSidebar.module.css'

const CompareIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
)

const LibraryIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
)

const TechIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
  </svg>
)

const SkillsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="9" y1="15" x2="15" y2="15" />
    <line x1="12" y1="12" x2="12" y2="18" />
  </svg>
)

const FolderIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
)

const MenuIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
  </svg>
)

type Counts = { prompts: number; techniques: number; skills: number }

type Props = {
  collapsed: boolean
  onToggleCollapse: () => void
  counts: Counts
  recentSessions: RecentSession[]
  workspaceLabel: string | null
}

export default function AppSidebar({ collapsed, onToggleCollapse, counts, recentSessions, workspaceLabel }: Props) {
  const location = useLocation()
  const navigate = useNavigate()
  const tab = new URLSearchParams(location.search).get('tab')

  const libraryPromptsActive = location.pathname === '/library' && tab !== 'techniques' && tab !== 'skills'
  const libraryTechActive = location.pathname === '/library' && tab === 'techniques'
  const librarySkillsActive = location.pathname === '/library' && tab === 'skills'

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ''}`} aria-label="Навигация">
      <div className={styles.sidebarInner}>
        <div className={styles.collapseRow}>
          <button
            type="button"
            className={styles.collapseBtn}
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
            title={collapsed ? 'Развернуть' : 'Свернуть'}
          >
            <MenuIcon />
          </button>
        </div>
        <div className={styles.scroll}>
          {workspaceLabel ? (
            <div className={styles.workspacePill} title={`Активное пространство: ${workspaceLabel}`}>
              <span className={styles.workspaceDot} aria-hidden />
              <span className={styles.workspaceName}>{workspaceLabel}</span>
            </div>
          ) : null}

          <div className={styles.section}>
            <div className={styles.sectionLabel}>Инструменты</div>
            <NavLink
              to="/compare"
              className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navActive : ''}`}
              title="Сравнение A/B"
            >
              <span className={styles.icon} aria-hidden>
                <CompareIcon />
              </span>
              <span className={styles.label}>Сравнение A/B</span>
            </NavLink>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionLabel}>Библиотека</div>
            <NavLink
              to="/library"
              className={`${styles.navItem} ${libraryPromptsActive ? styles.navActive : ''}`}
              title="Промпты"
            >
              <span className={styles.icon} aria-hidden>
                <LibraryIcon />
              </span>
              <span className={styles.label}>Промпты</span>
              <span className={styles.badge}>{counts.prompts}</span>
            </NavLink>
            <NavLink
              to="/library?tab=techniques"
              className={`${styles.navItem} ${libraryTechActive ? styles.navActive : ''}`}
              title="Техники"
            >
              <span className={styles.icon} aria-hidden>
                <TechIcon />
              </span>
              <span className={styles.label}>Техники</span>
              <span className={styles.badge}>{counts.techniques}</span>
            </NavLink>
            <NavLink
              to="/library?tab=skills"
              className={`${styles.navItem} ${librarySkillsActive ? styles.navActive : ''}`}
              title="Скиллы"
            >
              <span className={styles.icon} aria-hidden>
                <SkillsIcon />
              </span>
              <span className={styles.label}>Скиллы</span>
              <span className={styles.badge}>{counts.skills}</span>
            </NavLink>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionLabel}>Проекты</div>
            <NavLink
              to="/workspaces"
              className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navActive : ''}`}
              title="Пространства"
            >
              <span className={styles.icon} aria-hidden>
                <FolderIcon />
              </span>
              <span className={styles.label}>Пространства</span>
            </NavLink>
          </div>

          {recentSessions.length > 0 ? (
            <div className={styles.section}>
              <div className={styles.recentLabel}>Недавние</div>
              <div className={styles.recentList}>
                {recentSessions.map((s) => (
                  <button
                    key={s.sessionId}
                    type="button"
                    className={styles.recentCard}
                    title={s.label}
                    onClick={() => navigate('/home', { state: { restoreSessionId: s.sessionId } })}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  )
}
