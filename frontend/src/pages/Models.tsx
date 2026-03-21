import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api, type OpenRouterModel, type Settings } from '../api/client'
import styles from './Models.module.css'

function formatPrice(price: number | undefined): string {
  if (price == null || price === 0) return 'Бесплатно'
  // OpenRouter: price per token; show $/1M tokens
  const perM = price * 1_000_000
  if (perM < 0.01) return `$${perM.toFixed(4)}/1M`
  return `$${perM.toFixed(2)}/1M`
}

function formatContext(len: number | undefined): string {
  if (len == null) return '—'
  if (len >= 1_000_000) return `${(len / 1_000_000).toFixed(1)}M`
  if (len >= 1000) return `${(len / 1000).toFixed(0)}K`
  return String(len)
}

export default function Models() {
  const [models, setModels] = useState<OpenRouterModel[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<{ updated_at: number; from_cache: boolean } | null>(null)
  const [search, setSearch] = useState('')
  type SortKey = 'name' | 'id' | 'context' | 'prompt' | 'completion'
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const [trialMode, setTrialMode] = useState(false)

  const load = async (forceRefresh = false) => {
    if (forceRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const [res, settingsRes] = await Promise.all([api.getModels(forceRefresh), api.getSettings()])
      setModels(res.data)
      setSettings(settingsRes)
      setMeta({ updated_at: res.updated_at, from_cache: res.from_cache })
      setTrialMode(res.trial_mode ?? false)
      if (res.error) setError(res.error)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = search.trim()
    ? models.filter(
        (m) =>
          m.id.toLowerCase().includes(search.toLowerCase()) ||
          m.name.toLowerCase().includes(search.toLowerCase())
      )
    : models

  const selectedGen = new Set(settings?.preferred_generation_models || [])
  const selectedTarget = new Set(settings?.preferred_target_models || [])

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0
    if (sortKey === 'name') cmp = (a.name || a.id).localeCompare(b.name || b.id)
    else if (sortKey === 'id') cmp = a.id.localeCompare(b.id)
    else if (sortKey === 'context') cmp = (a.context_length ?? 0) - (b.context_length ?? 0)
    else if (sortKey === 'prompt') cmp = (a.pricing?.prompt ?? 0) - (b.pricing?.prompt ?? 0)
    else if (sortKey === 'completion') cmp = (a.pricing?.completion ?? 0) - (b.pricing?.completion ?? 0)
    return sortDir === 'asc' ? cmp : -cmp
  })

  const toggleSort = (key: SortKey) => {
    setSortKey(key)
    setSortDir((d) => (sortKey === key ? (d === 'asc' ? 'desc' : 'asc') : 'asc'))
  }

  const updatedStr = meta?.updated_at
    ? new Date(meta.updated_at * 1000).toLocaleString('ru-RU')
    : ''

  const toggleModel = async (kind: 'preferred_generation_models' | 'preferred_target_models', modelId: string) => {
    if (!settings) return
    setSaving(true)
    setError(null)
    try {
      const current = new Set(settings[kind] || [])
      if (current.has(modelId)) current.delete(modelId)
      else current.add(modelId)
      const updated = await api.updateSettings({
        [kind]: Array.from(current),
      })
      setSettings(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить набор моделей')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.models}>
      <div className={styles.header}>
        <h1>Модели OpenRouter</h1>
        <div className={styles.headerMeta}>
          <span className={styles.metric}>
            {models.length} моделей
            {meta?.from_cache && (
              <span className={styles.cacheBadge}> · кеш</span>
            )}
          </span>
          {updatedStr && (
            <span className={styles.updated}>Обновлено: {updatedStr}</span>
          )}
          <button
            className={styles.refreshBtn}
            onClick={() => load(true)}
            disabled={refreshing || loading}
          >
            {refreshing ? 'Обновление…' : 'Обновить'}
          </button>
        </div>
      </div>

      <p className={styles.subtitle}>
        Список моделей с ценами за токены. Данные обновляются раз в сутки.
      </p>

      {trialMode && (
        <div className={styles.trialBanner}>
          <strong>Пробный режим:</strong> доступны только модели с выходом ≤$1/1M токенов. Лимит 50 000 пробных токенов на пользователя.
          Введите свой API ключ OpenRouter в <Link to="/settings">Настройках</Link> для доступа ко всем моделям.
        </div>
      )}

      <div className={styles.toolbar}>
        <input
          type="search"
          placeholder="Поиск по названию или ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={styles.search}
        />
        {settings && (
          <div className={styles.selectionBar}>
            <span>В генерации: {settings.preferred_generation_models.length}</span>
            <span>В target set: {settings.preferred_target_models.filter((item) => item !== 'unknown').length}</span>
          </div>
        )}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {loading ? (
        <p className={styles.loading}>Загрузка моделей...</p>
      ) : filtered.length === 0 ? (
        <p className={styles.empty}>Модели не найдены</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.sortable} onClick={() => toggleSort('name')}>Модель {sortKey === 'name' && (sortDir === 'asc' ? '↑' : '↓')}</th>
                <th className={styles.sortable} onClick={() => toggleSort('context')}>Контекст {sortKey === 'context' && (sortDir === 'asc' ? '↑' : '↓')}</th>
                <th className={styles.sortable} onClick={() => toggleSort('prompt')}>Вход ($/1M) {sortKey === 'prompt' && (sortDir === 'asc' ? '↑' : '↓')}</th>
                <th className={styles.sortable} onClick={() => toggleSort('completion')}>Выход ($/1M) {sortKey === 'completion' && (sortDir === 'asc' ? '↑' : '↓')}</th>
                <th>Набор пользователя</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div className={styles.modelCell}>
                      <strong>{m.name}</strong>
                      <code className={styles.modelId}>{m.id}</code>
                    </div>
                  </td>
                  <td>{formatContext(m.context_length)}</td>
                  <td>{formatPrice(m.pricing?.prompt)}</td>
                  <td>{formatPrice(m.pricing?.completion)}</td>
                  <td>
                    <div className={styles.actionCell}>
                      <button
                        className={selectedGen.has(m.id) ? styles.removeBtn : styles.addBtn}
                        onClick={() => toggleModel('preferred_generation_models', m.id)}
                        disabled={saving}
                      >
                        {selectedGen.has(m.id) ? '− Генерация' : '+ Генерация'}
                      </button>
                      <button
                        className={selectedTarget.has(m.id) ? styles.removeBtn : styles.addBtn}
                        onClick={() => toggleModel('preferred_target_models', m.id)}
                        disabled={saving}
                      >
                        {selectedTarget.has(m.id) ? '− Target' : '+ Target'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
