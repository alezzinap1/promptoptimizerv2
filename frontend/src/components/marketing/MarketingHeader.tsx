import { Link } from 'react-router-dom'
import { useT } from '../../i18n'
import LanguageSwitcher from '../LanguageSwitcher'
import styles from './MarketingHeader.module.css'

export default function MarketingHeader() {
  const { t } = useT()
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link to="/welcome" className={styles.brand}>
          <span className={styles.glyph} aria-hidden>
            ◆
          </span>
          <span className={styles.wordmark}>MetaPrompt</span>
        </Link>
        <nav className={styles.nav} aria-label={t.landing.nav.aria}>
          <a href="#product">{t.landing.nav.product}</a>
          <Link to="/login">{t.landing.nav.studio}</Link>
          <Link to="/login">{t.landing.nav.library}</Link>
          <a href="#trust">{t.landing.nav.pricing}</a>
          <a href="https://github.com" target="_blank" rel="noreferrer noopener">
            {t.landing.nav.docs}
          </a>
        </nav>
        <div className={styles.actions}>
          <LanguageSwitcher />
          <Link to="/login" className={styles.login}>
            {t.common.login}
          </Link>
          <Link to="/login" className={styles.cta}>
            {t.landing.nav.startFree}
          </Link>
        </div>
      </div>
    </header>
  )
}
