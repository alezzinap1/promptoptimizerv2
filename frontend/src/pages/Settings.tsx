import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api, type Settings } from '../api/client'
import { FONTS, THEMES, useTheme } from '../context/ThemeContext'
import styles from './Settings.module.css'

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

export default function Settings() {
  const { theme, font, setTheme, setFont } = useTheme()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    api.getSettings()
      .then(setSettings)
      .catch((e) => setMessage({ type: 'err', text: e instanceof Error ? e.message : 'Не удалось загрузить настройки' }))
      .finally(() => setLoading(false))
  }, [])

  const handleSaveApiKey = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const updated = await api.updateSettings({ openrouter_api_key: apiKey })
      setSettings(updated)
      setApiKey('')
      setMessage({ type: 'ok', text: 'API ключ сохранён' })
    } catch (e) {
      setMessage({ type: 'err', text: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const handleClearApiKey = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const updated = await api.updateSettings({ openrouter_api_key: '' })
      setSettings(updated)
      setMessage({ type: 'ok', text: 'API ключ очищен' })
    } catch (e) {
      setMessage({ type: 'err', text: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.settings}>
      <h1>Настройки</h1>

      <section className={styles.section}>
        <h2>OpenRouter API</h2>
        <p className={styles.info}>
          Ваш персональный API ключ OpenRouter. Без ключа доступен пробный режим (50 000 токенов, модели ≤$1/1M).
          Ключ хранится на сервере и привязан к вашему аккаунту.
        </p>
        {settings?.openrouter_api_key_set && (
          <p className={styles.masked}>
            Текущий ключ: <code>{settings.openrouter_api_key_masked}</code>
          </p>
        )}
        {loading && <p className={styles.masked}>Загрузка текущих настроек…</p>}
        <div className={styles.row}>
          <input
            type="password"
            placeholder="sk-or-v1-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className={styles.input}
          />
          <button
            onClick={handleSaveApiKey}
            disabled={saving || !apiKey.trim()}
            className={styles.btn}
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
          <button
            onClick={handleClearApiKey}
            disabled={saving || !settings?.openrouter_api_key_set}
            className={styles.btn}
          >
            Очистить
          </button>
        </div>
        {message && (
          <p className={message.type === 'ok' ? styles.msgOk : styles.msgErr}>
            {message.text}
          </p>
        )}
      </section>

      <section className={styles.section}>
        <h2>Оформление</h2>
        <p className={styles.info}>
          Персональные визуальные настройки интерфейса.
        </p>
        <div className={styles.row}>
          <select value={theme} onChange={(e) => setTheme(e.target.value as (typeof THEMES)[number])} className={styles.input}>
            {THEMES.map((item) => (
              <option key={item} value={item}>{THEME_LABELS[item]}</option>
            ))}
          </select>
          <select value={font} onChange={(e) => setFont(e.target.value as (typeof FONTS)[number])} className={styles.input}>
            {FONTS.map((item) => (
              <option key={item} value={item}>{FONT_LABELS[item]}</option>
            ))}
          </select>
        </div>
      </section>

      <section className={styles.section}>
        <h2>Набор моделей пользователя</h2>
        <p className={styles.info}>
          Выбранные модели используются в `Home` и `Compare` как доступные варианты генерации и target model.
        </p>
        <p className={styles.masked}>
          Для генерации: <strong>{settings?.preferred_generation_models?.length ?? 0}</strong> моделей
        </p>
        <p className={styles.masked}>
          Target models: <strong>{settings?.preferred_target_models?.length ?? 0}</strong>
        </p>
        <Link to="/models" className={styles.btn}>Открыть каталог моделей</Link>
      </section>
    </div>
  )
}
