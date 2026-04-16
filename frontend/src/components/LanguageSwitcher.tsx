import { useT, type Lang } from '../i18n'
import styles from './LanguageSwitcher.module.css'

/*
 * Compact two-state toggle (RU | EN). Lives in both the marketing and
 * product headers. No dropdown — just two buttons; there are only two
 * languages and likely to stay that way for a while.
 */

export default function LanguageSwitcher() {
  const { lang, setLang, t, langs } = useT()

  return (
    <div
      className={styles.switch}
      role="group"
      aria-label={t.common.languageSwitch}
    >
      {langs.map((l: Lang) => (
        <button
          key={l}
          type="button"
          className={`${styles.btn} ${l === lang ? styles.btnActive : ''}`}
          onClick={() => setLang(l)}
          aria-pressed={l === lang}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
