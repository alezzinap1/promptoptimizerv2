import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import styles from './Layout.module.css'

const NAV_ITEMS = [
  { to: '/', label: 'Home' },
  { to: '/compare', label: 'Сравнение' },
  { to: '/library', label: 'Библиотека' },
  { to: '/techniques', label: 'Техники' },
  { to: '/metrics', label: 'Метрики' },
  { to: '/workspaces', label: 'Workspaces' },
  { to: '/models', label: 'Модели' },
  { to: '/user-info', label: 'User Info' },
]

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth()
  const location = useLocation()

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <nav className={styles.nav}>
          {NAV_ITEMS.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                isActive || (to === '/' && location.pathname === '/')
                  ? styles.navLinkActive
                  : styles.navLink
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className={styles.controls}>
          <div className={styles.userBox}>
            <span>{user?.username}</span>
            <NavLink to="/settings" className={styles.settingsBtn} title="Настройки">
              <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.settingsIcon}>
                <path d="M12 8.5A3.5 3.5 0 1 0 12 15.5A3.5 3.5 0 1 0 12 8.5Z" fill="none" stroke="currentColor" strokeWidth="1.7" />
                <path d="M19.4 15A1 1 0 0 0 19.6 16.1L20 16.8A1 1 0 0 1 19.7 18.1L18.1 19.7A1 1 0 0 1 16.8 20L16.1 19.6A1 1 0 0 0 15 19.4L14.2 19.7A1 1 0 0 0 13.5 20.6V21.5A1 1 0 0 1 12.5 22.5H10.5A1 1 0 0 1 9.5 21.5V20.6A1 1 0 0 0 8.8 19.7L8 19.4A1 1 0 0 0 6.9 19.6L6.2 20A1 1 0 0 1 4.9 19.7L3.3 18.1A1 1 0 0 1 3 16.8L3.4 16.1A1 1 0 0 0 3.6 15L3.3 14.2A1 1 0 0 0 2.4 13.5H1.5A1 1 0 0 1 0.5 12.5V10.5A1 1 0 0 1 1.5 9.5H2.4A1 1 0 0 0 3.3 8.8L3.6 8A1 1 0 0 0 3.4 6.9L3 6.2A1 1 0 0 1 3.3 4.9L4.9 3.3A1 1 0 0 1 6.2 3L6.9 3.4A1 1 0 0 0 8 3.6L8.8 3.3A1 1 0 0 0 9.5 2.4V1.5A1 1 0 0 1 10.5 0.5H12.5A1 1 0 0 1 13.5 1.5V2.4A1 1 0 0 0 14.2 3.3L15 3.6A1 1 0 0 0 16.1 3.4L16.8 3A1 1 0 0 1 18.1 3.3L19.7 4.9A1 1 0 0 1 20 6.2L19.6 6.9A1 1 0 0 0 19.4 8L19.7 8.8A1 1 0 0 0 20.6 9.5H21.5A1 1 0 0 1 22.5 10.5V12.5A1 1 0 0 1 21.5 13.5H20.6A1 1 0 0 0 19.7 14.2L19.4 15Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </NavLink>
            <button className={styles.logoutBtn} onClick={() => logout()}>
              Logout
            </button>
          </div>
        </div>
      </header>
      <hr className={styles.divider} />
      <main className={styles.main}>{children}</main>
    </div>
  )
}
