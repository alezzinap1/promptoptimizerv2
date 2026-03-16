import { useState, useEffect } from 'react'
import { api, type Settings } from '../api/client'
import styles from './Settings.module.css'

export default function Settings() {
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
          Укажите свой API ключ OpenRouter для генерации промптов. Ключ хранится локально на сервере.
          Альтернатива: переменная окружения <code>OPENROUTER_API_KEY</code> в <code>.env</code>.
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
          Тема и шрифт можно изменить в <strong>верхней панели</strong> справа (доступны на всех страницах).
        </p>
      </section>
    </div>
  )
}
