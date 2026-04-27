import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import type { RecentSession } from '../lib/recentSessions'
import ThemedTooltip from './ThemedTooltip'
import styles from './AppSidebar.module.css'

const CompareIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
)

const EvalIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v18h18" />
    <path d="M7 16l4-6 4 4 5-9" />
  </svg>
)

const LibraryIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
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

const PresetsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="13.5" cy="6.5" r="2.5" />
    <circle cx="6.5" cy="13.5" r="2.5" />
    <circle cx="17.5" cy="17.5" r="2.5" />
    <path d="M11.5 8l-3 5M15.5 14l-3 5" />
  </svg>
)

const MenuIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
  </svg>
)

type Counts = { prompts: number | null; skills: number }

type Props = {
  collapsed: boolean
  onToggleCollapse: () => void
  counts: Counts
  recentSessions: RecentSession[]
  workspaceLabel: string | null
  isAdmin?: boolean
}

const ShieldIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
  </svg>
)

const FeedModIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
)

export default function AppSidebar({
  collapsed,
  onToggleCollapse,
  counts,
  recentSessions,
  workspaceLabel,
  isAdmin,
}: Props) {
  const location = useLocation()
  const navigate = useNavigate()
  const tab = new URLSearchParams(location.search).get('tab')

  const libraryPromptsActive = location.pathname === '/library' && tab !== 'skills' && tab !== 'presets'
  const libraryPresetsActive = location.pathname === '/library' && tab === 'presets'
  const librarySkillsActive = location.pathname === '/library' && tab === 'skills'

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ''}`} aria-label="Навигация">
      <div className={styles.sidebarInner}>
        <div className={styles.collapseRow}>
          <ThemedTooltip content={collapsed ? 'Развернуть' : 'Свернуть'} side="right" delayMs={260}>
            <button
              type="button"
              className={styles.collapseBtn}
              onClick={onToggleCollapse}
              aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
            >
              <MenuIcon />
            </button>
          </ThemedTooltip>
        </div>
        <div className={styles.scroll}>
          {workspaceLabel ? (
            <ThemedTooltip content={`Активное пространство: ${workspaceLabel}`} side="right" delayMs={280} block>
              <div className={styles.workspacePill}>
                <span className={styles.workspaceDot} aria-hidden />
                <span className={styles.workspaceName}>{workspaceLabel}</span>
              </div>
            </ThemedTooltip>
          ) : null}

          <div className={styles.section}>
            <div className={styles.sectionLabel}>Инструменты</div>
            <ThemedTooltip content="Сравнение A/B" side="right" delayMs={260} block>
              <NavLink
                to="/compare"
                className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navActive : ''}`}
              >
                <span className={styles.icon} aria-hidden>
                  <CompareIcon />
                </span>
                <span className={styles.label}>Сравнение A/B</span>
              </NavLink>
            </ThemedTooltip>
            <ThemedTooltip
              content="История прогонов стабильности, лидерборд и отчёты (Eval Studio)"
              side="right"
              delayMs={260}
              block
            >
              <NavLink
                to="/eval"
                className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navActive : ''}`}
              >
                <span className={styles.icon} aria-hidden>
                  <EvalIcon />
                </span>
                <span className={styles.label}>История прогонов</span>
              </NavLink>
            </ThemedTooltip>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionLabel}>Библиотека</div>
            <ThemedTooltip content="Промпты" side="right" delayMs={260} block>
              <NavLink
                to="/library"
                className={`${styles.navItem} ${libraryPromptsActive ? styles.navActive : ''}`}
              >
                <span className={styles.icon} aria-hidden>
                  <LibraryIcon />
                </span>
                <span className={styles.label}>Мои промпты</span>
                <span className={styles.badge}>{counts.prompts === null ? '…' : counts.prompts}</span>
              </NavLink>
            </ThemedTooltip>
            <ThemedTooltip content="Пресеты" side="right" delayMs={260} block>
              <NavLink
                to="/library?tab=presets"
                className={`${styles.navItem} ${libraryPresetsActive ? styles.navActive : ''}`}
              >
                <span className={styles.icon} aria-hidden>
                  <PresetsIcon />
                </span>
                <span className={styles.label}>Пресеты</span>
              </NavLink>
            </ThemedTooltip>
            <ThemedTooltip content="Скиллы" side="right" delayMs={260} block>
              <NavLink
                to="/library?tab=skills"
                className={`${styles.navItem} ${librarySkillsActive ? styles.navActive : ''}`}
              >
                <span className={styles.icon} aria-hidden>
                  <SkillsIcon />
                </span>
                <span className={styles.label}>Скиллы</span>
                <span className={styles.badge}>{counts.skills}</span>
              </NavLink>
            </ThemedTooltip>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionLabel}>Сообщество</div>
            <ThemedTooltip content="Общая библиотека" side="right" delayMs={260} block>
              <NavLink
                to="/community"
                className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navActive : ''}`}
              >
                <span className={styles.icon} aria-hidden>&#127760;</span>
                <span className={styles.label}>Лента</span>
              </NavLink>
            </ThemedTooltip>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionLabel}>Проекты</div>
            <ThemedTooltip content="Пространства" side="right" delayMs={260} block>
              <NavLink
                to="/workspaces"
                className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navActive : ''}`}
              >
                <span className={styles.icon} aria-hidden>
                  <FolderIcon />
                </span>
                <span className={styles.label}>Пространства</span>
              </NavLink>
            </ThemedTooltip>
          </div>

          {isAdmin ? (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>Админ</div>
              <ThemedTooltip content="Дашборд и метрики" side="right" delayMs={260} block>
                <NavLink
                  to="/admin"
                  className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navActive : ''}`}
                >
                  <span className={styles.icon} aria-hidden>
                    <ShieldIcon />
                  </span>
                  <span className={styles.label}>Админка</span>
                </NavLink>
              </ThemedTooltip>
              <ThemedTooltip content="Модерация ленты сообщества" side="right" delayMs={260} block>
                <NavLink
                  to="/admin/community"
                  className={({ isActive }) => `${styles.navItem} ${isActive ? styles.navActive : ''}`}
                >
                  <span className={styles.icon} aria-hidden>
                    <FeedModIcon />
                  </span>
                  <span className={styles.label}>Лента (модерация)</span>
                </NavLink>
              </ThemedTooltip>
            </div>
          ) : null}

          {recentSessions.length > 0 ? (
            <div className={styles.section}>
              <ThemedTooltip
                content="Сессии на сервере (история версий). Черновик чата в студии дополнительно сохраняется в браузере до «Новый диалог»."
                side="right"
                delayMs={320}
                block
              >
                <div className={styles.recentLabel}>Сессии</div>
              </ThemedTooltip>
              <div className={styles.recentList}>
                {recentSessions.map((s) => (
                  <ThemedTooltip key={s.sessionId} content={s.label} side="right" delayMs={240} block>
                    <button
                      type="button"
                      className={styles.recentCard}
                      onClick={() => navigate('/home', { state: { restoreSessionId: s.sessionId } })}
                    >
                      {s.label}
                    </button>
                  </ThemedTooltip>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  )
}
