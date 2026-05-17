import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useT } from '../i18n'
import styles from './MobileBottomNav.module.css'

const StudioIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M12 3l9 5.5v7L12 21 3 15.5v-7L12 3z" strokeLinejoin="round" />
  </svg>
)

const LibraryIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
)

const CompareIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
)

const MoreIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
    <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
  </svg>
)

function isStudioPath(path: string) {
  return path === '/home' || path === '/simple' || path === '/onboarding'
}

export default function MobileBottomNav() {
  const { t } = useT()
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)

  const moreLinks = [
    { to: '/community', label: t.bottomNav.community },
    { to: '/eval', label: t.bottomNav.eval },
    { to: '/workspaces', label: t.bottomNav.workspaces },
    { to: '/settings', label: t.bottomNav.settings },
    { to: '/help', label: t.bottomNav.help },
  ]

  const closeMore = () => setMoreOpen(false)

  return (
    <>
      {moreOpen ? (
        <button
          type="button"
          className={styles.moreBackdrop}
          aria-label={t.header.menuClose}
          onClick={closeMore}
        />
      ) : null}
      {moreOpen ? (
        <div className={styles.moreSheet} role="dialog" aria-modal="true" aria-label={t.bottomNav.moreMenu}>
          <div className={styles.moreSheetInner}>
            {moreLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) => `${styles.moreLink} ${isActive ? styles.moreLinkActive : ''}`}
                onClick={closeMore}
              >
                {link.label}
              </NavLink>
            ))}
          </div>
        </div>
      ) : null}
      <nav className={styles.bar} aria-label={t.bottomNav.aria}>
        <NavLink
          to="/home"
          className={() =>
            `${styles.item} ${isStudioPath(location.pathname) ? styles.itemActive : ''}`
          }
          onClick={closeMore}
        >
          <span className={styles.icon}>
            <StudioIcon />
          </span>
          <span className={styles.label}>{t.bottomNav.studio}</span>
        </NavLink>
        <NavLink
          to="/library"
          className={({ isActive }) => `${styles.item} ${isActive ? styles.itemActive : ''}`}
          onClick={closeMore}
        >
          <span className={styles.icon}>
            <LibraryIcon />
          </span>
          <span className={styles.label}>{t.bottomNav.library}</span>
        </NavLink>
        <NavLink
          to="/compare"
          className={({ isActive }) => `${styles.item} ${isActive ? styles.itemActive : ''}`}
          onClick={closeMore}
        >
          <span className={styles.icon}>
            <CompareIcon />
          </span>
          <span className={styles.label}>{t.bottomNav.compare}</span>
        </NavLink>
        <button
          type="button"
          className={`${styles.item} ${moreOpen ? styles.itemActive : ''}`}
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
          onClick={() => setMoreOpen((v) => !v)}
        >
          <span className={styles.icon}>
            <MoreIcon />
          </span>
          <span className={styles.label}>{t.bottomNav.more}</span>
        </button>
      </nav>
    </>
  )
}
