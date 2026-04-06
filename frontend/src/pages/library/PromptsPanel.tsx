import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, type LibraryItem } from '../../api/client'
import { COMPLETENESS_SCORE_TITLE } from '../../lib/scoreTooltips'
import LibraryTagChips from '../../components/LibraryTagChips'
import SelectDropdown from '../../components/SelectDropdown'
import { CopyIconButton, TryInGeminiButton } from '../../components/PromptToolbarIcons'
import PublishToCommunityModal from '../../components/PublishToCommunityModal'
import { formatLibraryCardDates } from '../../lib/promptLibraryMeta'
import styles from '../Library.module.css'

function ratingLabel(rating: number | undefined | null) {
  const r = rating ?? 0
  if (r <= 0) return 'Нет оценки'
  return `★ ${r}/5`
}

const IMAGE_SIGNALS = ['image', 'картинк', 'изображен', 'midjourney', 'dall-e', 'dalle', 'stable diffusion', 'генерац', 'иллюстрац', 'фото', 'photo', 'visual', 'art', 'рисунок', 'рисов']

function isImagePrompt(item: LibraryItem): boolean {
  const text = `${item.title} ${item.tags.join(' ')} ${item.task_type} ${item.prompt.slice(0, 300)}`.toLowerCase()
  return IMAGE_SIGNALS.some((s) => text.includes(s))
}

type Props = {
  onPromptCountChanged?: () => void
  gridCols?: 3 | 4
}

export default function PromptsPanel({ onPromptCountChanged, gridCols = 3 }: Props) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [items, setItems] = useState<LibraryItem[]>([])
  const [stats, setStats] = useState<{ total: number; models?: string[]; task_types?: string[] }>({ total: 0 })
  const [search, setSearch] = useState('')
  const [taskType, setTaskType] = useState('all')
  const [sortBy, setSortBy] = useState<'rating' | 'date' | 'tokens' | 'name'>('rating')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [drafts, setDrafts] = useState<Record<number, { title: string; tags: string; notes: string; rating: number }>>({})
  const [evalId, setEvalId] = useState<number | null>(null)
  const [evalData, setEvalData] = useState<Record<string, unknown> | null>(null)
  const [evalLoading, setEvalLoading] = useState(false)
  const [tagPaintTick, setTagPaintTick] = useState(0)
  const [publishItem, setPublishItem] = useState<LibraryItem | null>(null)

  useEffect(() => {
    const onPaint = () => setTagPaintTick((t) => t + 1)
    window.addEventListener('metaprompt-tag-accent-changed', onPaint)
    return () => window.removeEventListener('metaprompt-tag-accent-changed', onPaint)
  }, [])

  useEffect(() => {
    api.getLibraryStats().then(setStats)
  }, [])

  useEffect(() => {
    const q = searchParams.get('search')
    if (q) setSearch(q)
  }, [searchParams])

  useEffect(() => {
    setLoading(true)
    setError(null)
    api
      .getLibrary({
        search: search || undefined,
        task_type: taskType !== 'all' ? taskType : undefined,
      })
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [search, taskType])

  const taskTypeOptions = useMemo(
    () => [
      { value: 'all', label: 'Все типы' },
      ...(stats.task_types || []).map((item) => ({ value: item, label: item })),
    ],
    [stats.task_types],
  )

  const sortOptions = useMemo(() => [
    { value: 'rating', label: 'По оценке' },
    { value: 'date', label: 'По дате' },
    { value: 'tokens', label: 'По токенам' },
    { value: 'name', label: 'По имени' },
  ], [])

  const sorted = useMemo(() => {
    const arr = [...items]
    switch (sortBy) {
      case 'rating': return arr.sort((a, b) => (b.rating || 0) - (a.rating || 0) || b.id - a.id)
      case 'date': return arr.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      case 'tokens': return arr.sort((a, b) => b.prompt.length - a.prompt.length)
      case 'name': return arr.sort((a, b) => a.title.localeCompare(b.title))
      default: return arr
    }
  }, [items, sortBy])

  const startEdit = (item: LibraryItem) => {
    setEditingId(item.id)
    setDrafts((prev) => ({
      ...prev,
      [item.id]: {
        title: item.title,
        tags: item.tags.join(', '),
        notes: item.notes || '',
        rating: item.rating || 0,
      },
    }))
  }

  const saveEdit = async (id: number) => {
    const draft = drafts[id]
    if (!draft) return
    await api.updateLibrary(id, {
      title: draft.title,
      tags: draft.tags.split(',').map((v) => v.trim()).filter(Boolean),
      notes: draft.notes,
      rating: draft.rating,
    })
    setEditingId(null)
    const refreshed = await api.getLibrary({
      search: search || undefined,
      task_type: taskType !== 'all' ? taskType : undefined,
    })
    setItems(refreshed.items)
    window.dispatchEvent(new CustomEvent('metaprompt-nav-refresh'))
  }

  const handleEval = async (item: LibraryItem) => {
    if (evalId === item.id) {
      setEvalId(null)
      setEvalData(null)
      return
    }
    setEvalId(item.id)
    setEvalLoading(true)
    try {
      const res = await api.evaluatePrompt(item.prompt, item.target_model, isImagePrompt(item) ? 'image' : 'text')
      setEvalData(res.metrics)
    } catch {
      setEvalData(null)
    } finally {
      setEvalLoading(false)
    }
  }

  const gridClass = gridCols === 4 ? styles.grid4 : styles.grid3

  return (
    <div className={styles.library}>
      <div className={`${styles.toolbar} ${styles.toolbarCompact}`}>
        <input
          type="search"
          placeholder="Поиск по тексту и тегам…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${styles.search} ${styles.searchCompact}`}
        />
        <SelectDropdown
          value={taskType}
          options={taskTypeOptions}
          onChange={setTaskType}
          aria-label="Тип задачи"
          variant="toolbar"
          className={`${styles.toolbarSelect} ${styles.toolbarSelectCompact}`}
        />
        <SelectDropdown
          value={sortBy}
          options={sortOptions}
          onChange={(v) => setSortBy(v as 'rating' | 'date' | 'tokens' | 'name')}
          aria-label="Сортировка"
          variant="toolbar"
          className={`${styles.toolbarSelect} ${styles.toolbarSelectCompact}`}
        />
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {publishItem && (
        <PublishToCommunityModal
          open
          onClose={() => setPublishItem(null)}
          onPublished={() => api.getLibraryStats().then(setStats)}
          initial={{
            title: publishItem.title,
            prompt: publishItem.prompt,
            description: publishItem.notes || '',
            prompt_type: isImagePrompt(publishItem) ? 'image' : 'text',
            tags: publishItem.tags,
          }}
        />
      )}

      {loading ? (
        <p>Загрузка...</p>
      ) : items.length === 0 ? (
        <p className={styles.empty}>Нет сохранённых промптов</p>
      ) : (
        <div key={tagPaintTick} className={`${styles.grid} ${gridClass}`}>
          {sorted.map((item) => (
            <div key={item.id} className={styles.card}>
              <button
                type="button"
                className={styles.cardTitleBtn}
                title="Открыть на Студии с этим промптом"
                onClick={() =>
                  navigate('/home', { state: { prefillTask: `Улучши этот промпт:\n\n${item.prompt}`, clearResult: true } })
                }
              >
                {item.title}
              </button>
              {item.created_at ? (
                <p className={styles.cardDates}>{formatLibraryCardDates(item.created_at, item.updated_at)}</p>
              ) : null}
              <p className={styles.meta}>
                <span className={styles.taskTypeLabel} title="Тип задачи при сохранении">
                  {item.task_type}
                </span>
                {isImagePrompt(item) && (
                  <span className={styles.imageBadge} title="Промпт для генерации изображений">
                    🎨
                  </span>
                )}
                {item.target_model && item.target_model !== 'unknown' && (
                  <span className={styles.modelBadge} title="Целевая модель">
                    {item.target_model}
                  </span>
                )}
                <span className={styles.ratingBadge} title="Оценка по шкале от 0 до 5 звёзд">
                  {ratingLabel(item.rating)}
                </span>
                <span className={styles.tokenBadgeMini} title="Приблизительное количество токенов">
                  ≈{Math.max(1, Math.round(item.prompt.length / 3.5)).toLocaleString()} tok
                </span>
              </p>
              {item.tags.length > 0 ? <LibraryTagChips tags={item.tags} className={styles.tagChipsMargin} /> : null}
              <div className={styles.promptBlock}>
                <pre className={styles.preview}>
                  {item.prompt.slice(0, 200)}
                  {item.prompt.length > 200 ? '…' : ''}
                </pre>
              </div>
              <div className={styles.cardActions}>
                <button
                  type="button"
                  className={`${styles.openBtn} ${styles.openBtnAccent} btn-primary`}
                  title="Открыть на Студии с этим промптом"
                  onClick={() =>
                    navigate('/home', { state: { prefillTask: `Улучши этот промпт:\n\n${item.prompt}`, clearResult: true } })
                  }
                >
                  <svg className={styles.openBtnIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  Открыть
                </button>
                <TryInGeminiButton
                  prompt={item.prompt}
                  title={
                    isImagePrompt(item)
                      ? 'Скопировать и открыть чат ИИ (для изображений часто выбирают Gemini)'
                      : 'Скопировать промпт и открыть чат ИИ'
                  }
                />
                <CopyIconButton text={item.prompt} title="Копировать текст промпта в буфер обмена" />
                <details className={styles.cardMore}>
                  <summary className={styles.cardMoreSummary} title="Другие действия">
                    Ещё
                  </summary>
                  <div className={styles.cardMoreMenu}>
                    <button type="button" className={styles.cardMoreItem} onClick={() => setPublishItem(item)}>
                      Опубликовать в сообщество
                    </button>
                    <button type="button" className={styles.cardMoreItem} onClick={() => startEdit(item)}>
                      Редактировать карточку
                    </button>
                    <button
                      type="button"
                      className={`${styles.cardMoreItem} ${evalId === item.id ? styles.cardMoreItemActive : ''}`}
                      onClick={() => handleEval(item)}
                    >
                      Оценить качество (полнота)
                    </button>
                    <button
                      type="button"
                      className={`${styles.cardMoreItem} ${styles.cardMoreDanger}`}
                      onClick={async () => {
                        await api.deleteLibrary(item.id)
                        setItems((prev) => prev.filter((x) => x.id !== item.id))
                        api.getLibraryStats().then(setStats)
                        onPromptCountChanged?.()
                        window.dispatchEvent(new CustomEvent('metaprompt-nav-refresh'))
                      }}
                    >
                      Удалить из библиотеки
                    </button>
                  </div>
                </details>
              </div>
              {evalId === item.id && (
                <div className={styles.evalInline}>
                  {evalLoading ? (
                    <span className={styles.evalInlineLoading}>Оцениваю…</span>
                  ) : evalData ? (
                    <>
                      <div className={styles.evalInlineRow} title={COMPLETENESS_SCORE_TITLE}>
                        <span className={styles.evalInlineLabel}>Полнота</span>
                        <div className={styles.evalMiniBar}>
                          <div className={styles.evalMiniBarFill} style={{ width: `${Math.min(100, Number(evalData.completeness_score ?? 0))}%` }} />
                        </div>
                        <span className={styles.evalInlineVal}>{String(evalData.completeness_score ?? 0)}%</span>
                      </div>
                      <div className={styles.evalInlineChips}>
                        {evalData.has_role ? <span className={styles.evalChipGood}>роль</span> : <span className={styles.evalChipMiss}>роль</span>}
                        {evalData.has_output_format ? <span className={styles.evalChipGood}>формат</span> : <span className={styles.evalChipMiss}>формат</span>}
                        {evalData.has_examples ? <span className={styles.evalChipGood}>примеры</span> : <span className={styles.evalChipMiss}>примеры</span>}
                        {evalData.has_context ? <span className={styles.evalChipGood}>контекст</span> : <span className={styles.evalChipMiss}>контекст</span>}
                      </div>
                      {Array.isArray(evalData.improvement_tips) && (evalData.improvement_tips as string[]).length > 0 && (
                        <ul className={styles.evalTips}>
                          {(evalData.improvement_tips as string[]).slice(0, 3).map((tip, i) => (
                            <li key={i}>{tip}</li>
                          ))}
                        </ul>
                      )}
                    </>
                  ) : (
                    <span className={styles.evalInlineLoading}>Ошибка оценки</span>
                  )}
                </div>
              )}
              {editingId === item.id && drafts[item.id] && (
                <div className={styles.editBox}>
                  <input
                    value={drafts[item.id].title}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [item.id]: { ...prev[item.id], title: e.target.value } }))
                    }
                  />
                  <input
                    value={drafts[item.id].tags}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [item.id]: { ...prev[item.id], tags: e.target.value } }))
                    }
                    placeholder="Теги через запятую"
                  />
                  <textarea
                    rows={3}
                    value={drafts[item.id].notes}
                    onChange={(e) =>
                      setDrafts((prev) => ({ ...prev, [item.id]: { ...prev[item.id], notes: e.target.value } }))
                    }
                  />
                  <label>
                    Оценка (0–5)
                    <input
                      type="range"
                      min={0}
                      max={5}
                      step={1}
                      value={drafts[item.id].rating}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [item.id]: { ...prev[item.id], rating: Number(e.target.value) },
                        }))
                      }
                    />
                  </label>
                  <div className={styles.cardActions}>
                    <button type="button" className="btn-primary" onClick={() => saveEdit(item.id)}>
                      Сохранить
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => setEditingId(null)}>
                      Отмена
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
