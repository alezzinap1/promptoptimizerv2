import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { api, type OpenRouterModel, type Settings } from '../api/client'
import styles from './Models.module.css'

function formatPrice(price: number | undefined): string {
  if (price == null || price === 0) return 'Бесплатно'
  const perM = price * 1_000_000
  if (perM < 0.01) return `$${perM.toFixed(4)}`
  return `$${perM.toFixed(2)}`
}

function formatPriceRange(min: number, max: number): string {
  if (min === max) return formatPrice(min)
  return `${formatPrice(min)} – ${formatPrice(max)}`
}

function formatContext(len: number | undefined): string {
  if (len == null) return '—'
  if (len >= 1_000_000) return `${(len / 1_000_000).toFixed(1)}M`
  if (len >= 1000) return `${(len / 1000).toFixed(0)}K`
  return String(len)
}

function formatContextRange(min: number, max: number): string {
  if (min === max) return formatContext(min)
  return `${formatContext(min)} – ${formatContext(max)}`
}

function providerOf(id: string): string {
  return id.split('/')[0]
}

interface ProviderGroup {
  provider: string
  models: OpenRouterModel[]
  contextMin: number
  contextMax: number
  promptMin: number
  promptMax: number
  completionMin: number
  completionMax: number
}

function buildGroups(models: OpenRouterModel[]): { singles: OpenRouterModel[]; groups: ProviderGroup[] } {
  const map = new Map<string, OpenRouterModel[]>()
  for (const m of models) {
    const p = providerOf(m.id)
    if (!map.has(p)) map.set(p, [])
    map.get(p)!.push(m)
  }

  const singles: OpenRouterModel[] = []
  const groups: ProviderGroup[] = []

  for (const [provider, ms] of map) {
    if (ms.length === 1) {
      singles.push(ms[0])
    } else {
      const contexts = ms.map((m) => m.context_length ?? 0).filter(Boolean)
      const prompts = ms.map((m) => m.pricing?.prompt ?? 0)
      const completions = ms.map((m) => m.pricing?.completion ?? 0)
      groups.push({
        provider,
        models: [...ms].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id)),
        contextMin: contexts.length ? Math.min(...contexts) : 0,
        contextMax: contexts.length ? Math.max(...contexts) : 0,
        promptMin: Math.min(...prompts),
        promptMax: Math.max(...prompts),
        completionMin: Math.min(...completions),
        completionMax: Math.max(...completions),
      })
    }
  }

  return { singles, groups }
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
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set())
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

  const isSearching = search.trim().length > 0

  // Flat filtered list for search mode
  const flatFiltered = useMemo(() => {
    if (!isSearching) return models
    const q = search.toLowerCase()
    return models.filter(
      (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
    )
  }, [models, search, isSearching])

  // Sorted flat list (for search mode)
  const flatSorted = useMemo(() => {
    return [...flatFiltered].sort((a, b) => {
      const cmp = (a.name || a.id).localeCompare(b.name || b.id)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [flatFiltered, sortDir])

  // Grouped view (for non-search mode)
  const { singles, groups } = useMemo(() => {
    const allSorted = [...models].sort((a, b) => {
      const pa = providerOf(a.id)
      const pb = providerOf(b.id)
      const cmp = pa.localeCompare(pb)
      return sortDir === 'asc' ? cmp : -cmp
    })
    return buildGroups(allSorted)
  }, [models, sortDir])

  // Singles sorted by provider name then model name
  const singlesSorted = useMemo(() => {
    return [...singles].sort((a, b) => {
      const cmp = providerOf(a.id).localeCompare(providerOf(b.id))
      if (cmp !== 0) return sortDir === 'asc' ? cmp : -cmp
      return (a.name || a.id).localeCompare(b.name || b.id)
    })
  }, [singles, sortDir])

  // Groups sorted by provider name
  const groupsSorted = useMemo(() => {
    return [...groups].sort((a, b) => {
      const cmp = a.provider.localeCompare(b.provider)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [groups, sortDir])

  const selectedGen = new Set(settings?.preferred_generation_models || [])

  const updatedStr = meta?.updated_at
    ? new Date(meta.updated_at * 1000).toLocaleString('ru-RU')
    : ''

  const toggleGenModel = async (modelId: string) => {
    if (!settings) return
    setSaving(true)
    setError(null)
    try {
      const current = new Set(settings.preferred_generation_models || [])
      if (current.has(modelId)) current.delete(modelId)
      else current.add(modelId)
      const updated = await api.updateSettings({ preferred_generation_models: Array.from(current) })
      setSettings(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить набор моделей')
    } finally {
      setSaving(false)
    }
  }

  const toggleProvider = (provider: string) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev)
      if (next.has(provider)) next.delete(provider)
      else next.add(provider)
      return next
    })
  }

  const renderActionCell = (m: OpenRouterModel) => (
    <div className={styles.actionCell}>
      <button
        className={selectedGen.has(m.id) ? styles.removeBtn : styles.addBtn}
        onClick={() => toggleGenModel(m.id)}
        disabled={saving}
      >
        {selectedGen.has(m.id) ? '− Генерация' : '+ Генерация'}
      </button>
    </div>
  )

  return (
    <div className={styles.models}>
      <div className={styles.header}>
        <h1>Модели OpenRouter</h1>
        <div className={styles.headerMeta}>
          <span className={styles.metric}>
            {models.length} моделей
            {meta?.from_cache && <span className={styles.cacheBadge}> · кеш</span>}
          </span>
          {updatedStr && <span className={styles.updated}>Обновлено: {updatedStr}</span>}
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
        Список моделей. Цены в колонках «Вход» и «Выход» — в USD за 1M токенов. Данные обновляются раз в сутки.
      </p>

      {trialMode && (
        <div className={styles.trialBanner}>
          <strong>Пробный режим:</strong> доступны только модели с выходом ≤$1/1M токенов. Лимит 50 000 пробных токенов на пользователя.
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
          </div>
        )}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {loading ? (
        <p className={styles.loading}>Загрузка моделей...</p>
      ) : (isSearching ? flatSorted : [...groupsSorted, ...singlesSorted]).length === 0 ? (
        <p className={styles.empty}>Модели не найдены</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th
                  className={styles.sortable}
                  onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                >
                  {isSearching ? 'Модель' : 'Провайдер / Модель'} {sortDir === 'asc' ? '↑' : '↓'}
                </th>
                <th>Контекст</th>
                <th>Вход</th>
                <th>Выход</th>
                <th>Набор пользователя</th>
              </tr>
            </thead>
            <tbody>
              {isSearching ? (
                // Flat search view — show full info with ID
                flatSorted.map((m) => (
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
                    <td>{renderActionCell(m)}</td>
                  </tr>
                ))
              ) : (
                <>
                  {/* Provider groups (2+ models) */}
                  {groupsSorted.map((g) => {
                    const isExpanded = expandedProviders.has(g.provider)
                    return [
                      <tr
                        key={`group-${g.provider}`}
                        className={styles.providerRow}
                        onClick={() => toggleProvider(g.provider)}
                      >
                        <td>
                          <div className={styles.providerCell}>
                            <span className={`${styles.expandIcon} ${isExpanded ? styles.expandIconOpen : ''}`}>▶</span>
                            <strong>{g.provider}</strong>
                            <span className={styles.modelCount}>{g.models.length} моделей</span>
                          </div>
                        </td>
                        <td className={styles.rangeCell}>
                          {g.contextMin || g.contextMax
                            ? formatContextRange(g.contextMin, g.contextMax)
                            : '—'}
                        </td>
                        <td className={styles.rangeCell}>
                          {formatPriceRange(g.promptMin, g.promptMax)}
                        </td>
                        <td className={styles.rangeCell}>
                          {formatPriceRange(g.completionMin, g.completionMax)}
                        </td>
                        <td />
                      </tr>,
                      ...(isExpanded
                        ? g.models.map((m) => (
                            <tr key={m.id} className={styles.nestedRow}>
                              <td>
                                <div className={styles.nestedModelCell}>
                                  <span className={styles.nestedIndent} />
                                  <span>{m.name}</span>
                                </div>
                              </td>
                              <td>{formatContext(m.context_length)}</td>
                              <td>{formatPrice(m.pricing?.prompt)}</td>
                              <td>{formatPrice(m.pricing?.completion)}</td>
                              <td>{renderActionCell(m)}</td>
                            </tr>
                          ))
                        : []),
                    ]
                  })}
                  {/* Singles (1 model per provider) */}
                  {singlesSorted.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <div className={styles.modelCell}>
                          <strong>{m.name}</strong>
                        </div>
                      </td>
                      <td>{formatContext(m.context_length)}</td>
                      <td>{formatPrice(m.pricing?.prompt)}</td>
                      <td>{formatPrice(m.pricing?.completion)}</td>
                      <td>{renderActionCell(m)}</td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
