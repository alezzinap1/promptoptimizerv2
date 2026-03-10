import { NavLink, useLocation } from 'react-router-dom'
import { useTheme } from '../context/ThemeContext'
import styles from './Layout.module.css'

const NAV_ITEMS = [
  { to: '/', label: 'Home' },
  { to: '/compare', label: 'Сравнение' },
  { to: '/library', label: 'Библиотека' },
  { to: '/techniques', label: 'Техники' },
  { to: '/settings', label: 'Настройки' },
]

const THEME_LABELS: Record<string, string> = {
  slate: 'Slate',
  forest: 'Forest',
  light: 'Light',
  midnight: 'Midnight',
  amber: 'Amber',
  ocean: 'Ocean',
}

const FONT_LABELS: Record<string, string> = {
  jetbrains: 'JetBrains Mono',
  inter: 'Inter',
  ibmplex: 'IBM Plex Sans',
  plusjakarta: 'Plus Jakarta Sans',
  spacegrotesk: 'Space Grotesk',
  manrope: 'Manrope',
  outfit: 'Outfit',
  firacode: 'Fira Code',
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { theme, font, setTheme, setFont } = useTheme()
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
          <div className={styles.selectGroup}>
            <label>Тема</label>
            <select value={theme} onChange={(e) => setTheme(e.target.value as any)}>
              {Object.entries(THEME_LABELS).map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </div>
          <div className={styles.selectGroup}>
            <label>Шрифт</label>
            <select value={font} onChange={(e) => setFont(e.target.value as any)}>
              {Object.entries(FONT_LABELS).map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
          </div>
        </div>
      </header>
      <hr className={styles.divider} />
      <main className={styles.main}>{children}</main>
    </div>
  )
}
