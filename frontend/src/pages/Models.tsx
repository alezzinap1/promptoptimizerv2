import { useState, useEffect } from 'react'
import { api, type OpenRouterModel } from '../api/client'
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
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<{ updated_at: number; from_cache: boolean } | null>(null)
  const [search, setSearch] = useState('')

  const load = async (forceRefresh = false) => {
    if (forceRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const res = await api.getModels(forceRefresh)
      setModels(res.data)
      setMeta({ updated_at: res.updated_at, from_cache: res.from_cache })
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

  const updatedStr = meta?.updated_at
    ? new Date(meta.updated_at * 1000).toLocaleString('ru-RU')
    : ''

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

      <div className={styles.toolbar}>
        <input
          type="search"
          placeholder="Поиск по названию или ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={styles.search}
        />
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
                <th>Модель</th>
                <th>Контекст</th>
                <th>Вход ($/1M)</th>
                <th>Выход ($/1M)</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
