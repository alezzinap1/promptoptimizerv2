import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import UserMenu from './UserMenu'
import styles from './Layout.module.css'

const NAV_ITEMS = [
  { to: '/home', label: 'Главная', icon: 'home' },
  { to: '/simple', label: 'Простой режим', icon: 'zap' },
  { to: '/compare', label: 'Сравнение', icon: 'compare' },
  { to: '/library', label: 'Библиотека', icon: 'library' },
  { to: '/workspaces', label: 'Пространства', icon: 'workspaces' },
] as const

const icons: Record<string, JSX.Element> = {
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  zap: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  compare: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  library: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  ),
  workspaces: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  ),
  user: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.logoSection}>
          <NavLink to="/home" className={styles.logo}>
            <span className={styles.logoGlyph} aria-hidden />
            <span className={styles.logoText}>metaprompt</span>
          </NavLink>
        </div>
        <nav className={styles.nav}>
          {NAV_ITEMS.map((item) => {
            const { to, label, icon } = item
            return (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => (isActive ? styles.navLinkActive : styles.navLink)}
              >
                <span className={styles.navIcon}>{icons[icon]}</span>
                <span className={styles.navLabel}>{label}</span>
              </NavLink>
            )
          })}
        </nav>
        <div className={styles.controls}>
          {user ? (
            <div className={styles.userBox}>
              <div className={styles.userAvatar}>
                {icons.user}
              </div>
              <span className={styles.userName}>{user?.username}</span>
              <UserMenu />
            </div>
          ) : (
            <NavLink to="/login" className={styles.loginBtn}>
              Войти
            </NavLink>
          )}
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  )
}
