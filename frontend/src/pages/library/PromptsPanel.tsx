import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, type LibraryItem } from '../../api/client'
import { COMPLETENESS_SCORE_TITLE } from '../../lib/scoreTooltips'
import LibraryTagChips from '../../components/LibraryTagChips'
import SelectDropdown from '../../components/SelectDropdown'
import { CopyIconButton, TryInGeminiButton } from '../../components/PromptToolbarIcons'
import PublishToCommunityModal from '../../components/PublishToCommunityModal'
import { formatLibraryCardDates } from '../../lib/promptLibraryMeta'
import { libraryUserTurnFromCard } from '../../lib/libraryPickText'
import { useT } from '../../i18n'
import { getStartersForGoal, type StarterGoal } from '../../lib/starterPrompts'
import EvalBadge from '../eval/EvalBadge'
import styles from '../Library.module.css'

type LibraryView = 'all' | 'recent' | 'best' | 'stale' | 'untagged'

const LS_ONBOARDING_GOAL = 'metaprompt-onboarding-goal'

function readGoal(): StarterGoal | null {
  try {
    const v = localStorage.getItem(LS_ONBOARDING_GOAL)
    if (v === 'work' || v === 'study' || v === 'own') return v
  } catch {
    /* ignore */
  }
  return null
}

const DAY_MS = 24 * 60 * 60 * 1000

function applyView(items: LibraryItem[], view: LibraryView): LibraryItem[] {
  if (view === 'all') return items
  if (view === 'untagged') return items.filter((i) => (i.tags || []).length === 0)
  const now = Date.now()
  if (view === 'recent') {
    return items.filter((i) => {
      const t = Date.parse(i.updated_at || i.created_at || '')
      return !Number.isNaN(t) && now - t <= 7 * DAY_MS
    })
  }
  if (view === 'stale') {
    return items.filter((i) => {
      const t = Date.parse(i.updated_at || i.created_at || '')
      return !Number.isNaN(t) && now - t >= 30 * DAY_MS
    })
  }
  if (view === 'best') {
    return [...items].sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 10)
  }
  return items
}

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
  const { t } = useT()
  const [searchParams] = useSearchParams()
  const [items, setItems] = useState<LibraryItem[]>([])
  const [stats, setStats] = useState<{ total: number; models?: string[]; task_types?: string[] }>({ total: 0 })
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [taskType, setTaskType] = useState('all')
  const [view, setView] = useState<LibraryView>('all')
  const [sortBy, setSortBy] = useState<'rating' | 'date' | 'tokens' | 'name'>('rating')
  const [starterBusy, setStarterBusy] = useState<string | null>(null)
  const [starterAdded, setStarterAdded] = useState<Record<string, boolean>>({})
  const [starterErr, setStarterErr] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [drafts, setDrafts] = useState<Record<number, { title: string; tags: string; notes: string; rating: number }>>({})
  const [evalId, setEvalId] = useState<number | null>(null)
  const [evalData, setEvalData] = useState<Record<string, unknown> | null>(null)
  const [evalLoading, setEvalLoading] = useState(false)
  const [tagPaintTick, setTagPaintTick] = useState(0)
  const [publishItem, setPublishItem] = useState<LibraryItem | null>(null)
  const [pairStabilityA, setPairStabilityA] = useState<LibraryItem | null>(null)
  const [langView, setLangView] = useState<Record<number, 'primary' | 'alt'>>({})
  const [translating, setTranslating] = useState<Record<number, boolean>>({})
  const [translateErr, setTranslateErr] = useState<Record<number, string>>({})
  // Server-side onboarding goal wins over localStorage once available so
  // the empty-state starters work across devices (Phase 9).
  const [serverGoal, setServerGoal] = useState<StarterGoal | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .getSettings()
      .then((s) => {
        if (cancelled) return
        const g = (s.user_goal || '').trim()
        if (g === 'work' || g === 'study' || g === 'own') setServerGoal(g)
      })
      .catch(() => { /* non-fatal — localStorage fallback still works */ })
    return () => { cancelled = true }
  }, [])

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

  // Debounce user input by 200ms so that typing doesn't hammer the
  // backend on every keystroke — keeps the grid feeling fast on long
  // libraries.
  useEffect(() => {
    const h = window.setTimeout(() => setDebouncedSearch(search), 200)
    return () => window.clearTimeout(h)
  }, [search])

  useEffect(() => {
    setLoading(true)
    setError(null)
    api
      .getLibrary({
        search: debouncedSearch || undefined,
        task_type: taskType !== 'all' ? taskType : undefined,
      })
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [debouncedSearch, taskType])

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

  const viewed = useMemo(() => applyView(items, view), [items, view])

  const sorted = useMemo(() => {
    const arr = [...viewed]
    switch (sortBy) {
      case 'rating': return arr.sort((a, b) => (b.rating || 0) - (a.rating || 0) || b.id - a.id)
      case 'date': return arr.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      case 'tokens': return arr.sort((a, b) => b.prompt.length - a.prompt.length)
      case 'name': return arr.sort((a, b) => a.title.localeCompare(b.title))
      default: return arr
    }
  }, [viewed, sortBy])

  const viewOptions: { id: LibraryView; label: string }[] = useMemo(
    () => [
      { id: 'all', label: t.library.views.all },
      { id: 'recent', label: t.library.views.recent },
      { id: 'best', label: t.library.views.best },
      { id: 'stale', label: t.library.views.stale },
      { id: 'untagged', label: t.library.views.untagged },
    ],
    [t],
  )

  const isTrulyEmpty =
    !loading && stats.total === 0 && !debouncedSearch && taskType === 'all' && view === 'all'

  const addStarter = async (starterId: string, title: string, body: string, tags: string[], taskType: string) => {
    setStarterBusy(starterId)
    setStarterErr((p) => {
      const n = { ...p }
      delete n[starterId]
      return n
    })
    try {
      await api.saveToLibrary({ title, prompt: body, tags, task_type: taskType })
      setStarterAdded((p) => ({ ...p, [starterId]: true }))
      const s = await api.getLibraryStats()
      setStats(s)
      onPromptCountChanged?.()
      const refreshed = await api.getLibrary({})
      setItems(refreshed.items)
    } catch (e) {
      setStarterErr((p) => ({
        ...p,
        [starterId]: e instanceof Error ? e.message : t.library.starters.failed,
      }))
    } finally {
      setStarterBusy(null)
    }
  }

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

  const masonryClass = gridCols === 4 ? `${styles.masonry} ${styles.masonry4}` : styles.masonry

  const displayPromptFor = (item: LibraryItem): { text: string; lang: string } => {
    const view = langView[item.id] || 'primary'
    if (view === 'alt' && item.prompt_alt) {
      return { text: item.prompt_alt, lang: (item.prompt_alt_lang || '').toUpperCase() || 'ALT' }
    }
    return { text: item.prompt, lang: (item.prompt_lang || '').toUpperCase() || '' }
  }

  const handleTranslate = async (item: LibraryItem) => {
    setTranslating((prev) => ({ ...prev, [item.id]: true }))
    setTranslateErr((prev) => {
      const next = { ...prev }
      delete next[item.id]
      return next
    })
    try {
      const res = await api.translateLibraryItem(item.id)
      setItems((prev) =>
        prev.map((x) =>
          x.id === item.id
            ? {
                ...x,
                prompt_alt: res.prompt_alt,
                prompt_alt_lang: res.prompt_alt_lang,
                prompt_lang: res.prompt_lang,
              }
            : x,
        ),
      )
      setLangView((prev) => ({ ...prev, [item.id]: 'alt' }))
    } catch (e) {
      setTranslateErr((prev) => ({
        ...prev,
        [item.id]: e instanceof Error ? e.message : 'Ошибка перевода',
      }))
    } finally {
      setTranslating((prev) => {
        const next = { ...prev }
        delete next[item.id]
        return next
      })
    }
  }

  return (
    <div className={styles.library}>
      <div className={`${styles.toolbar} ${styles.toolbarCompact}`}>
        <input
          type="search"
          placeholder={t.library.searchPlaceholder}
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

      {!isTrulyEmpty && (
        <div className={styles.viewsRow} role="tablist" aria-label={t.library.views.label}>
          {viewOptions.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="tab"
              aria-selected={view === opt.id}
              className={view === opt.id ? styles.viewChipActive : styles.viewChip}
              onClick={() => setView(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

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

      {pairStabilityA && (
        <div
          className={styles.pairStabilityBackdrop}
          role="dialog"
          aria-modal="true"
          aria-labelledby="pair-stab-title"
          onClick={() => setPairStabilityA(null)}
        >
          <div className={styles.pairStabilityDialog} onClick={(e) => e.stopPropagation()}>
            <h3 id="pair-stab-title" className={styles.pairStabilityTitle}>
              Второй промпт для пары (B)
            </h3>
            <p className={styles.pairStabilityHint}>
              «{pairStabilityA.title}» — выберите карточку B для сравнения в режиме стабильности.
            </p>
            <div className={styles.pairStabilityList}>
              {sorted.filter((i) => i.id !== pairStabilityA.id).length === 0 ? (
                <p className={styles.pairStabilityHint} style={{ padding: '8px 4px' }}>
                  Нет другой карточки в текущем списке — измените поиск или добавьте промпт.
                </p>
              ) : (
                sorted
                  .filter((i) => i.id !== pairStabilityA.id)
                  .map((bItem) => {
                    const bPreview = displayPromptFor(bItem).text
                    return (
                      <button
                        key={bItem.id}
                        type="button"
                        className={styles.pairStabilityRow}
                        onClick={() => {
                          const tA = displayPromptFor(pairStabilityA).text
                          const tB = displayPromptFor(bItem).text
                          navigate(
                            { pathname: '/compare', search: '?mode=stability' },
                            {
                              state: {
                                stability: {
                                  libraryIdA: pairStabilityA.id,
                                  libraryIdB: bItem.id,
                                  promptA: tA,
                                  promptB: tB,
                                  taskInput: libraryUserTurnFromCard(pairStabilityA),
                                },
                              },
                            },
                          )
                          setPairStabilityA(null)
                        }}
                      >
                        <span className={styles.pairStabilityRowTitle}>{bItem.title}</span>
                        <span className={styles.pairStabilityRowMeta} title={bPreview}>
                          {bPreview.slice(0, 120)}
                          {bPreview.length > 120 ? '…' : ''}
                        </span>
                      </button>
                    )
                  })
              )}
            </div>
            <div className={styles.pairStabilityFooter}>
              <button type="button" className="btn-ghost" onClick={() => setPairStabilityA(null)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <p>Загрузка...</p>
      ) : isTrulyEmpty ? (
        <div className={styles.starters}>
          <div className={styles.starterHeader}>
            <div className={styles.starterEyebrow}>{t.library.starters.eyebrow}</div>
            <h2 className={styles.starterTitle}>{t.library.starters.title}</h2>
            <p className={styles.starterLede}>{t.library.starters.lede}</p>
          </div>
          <div className={styles.starterGrid}>
            {(() => {
              const goal = serverGoal || readGoal()
              const starters = getStartersForGoal(goal)
              const goalTag =
                goal === 'study'
                  ? t.library.starters.goalTag.study
                  : goal === 'own'
                    ? t.library.starters.goalTag.own
                    : t.library.starters.goalTag.work
              return starters.map((sp) => {
                const busy = starterBusy === sp.id
                const added = !!starterAdded[sp.id]
                const err = starterErr[sp.id]
                return (
                  <div key={sp.id} className={styles.starterCard}>
                    <div className={styles.starterCardGoalTag}>{goalTag}</div>
                    <div className={styles.starterCardTitle}>{sp.title}</div>
                    <pre className={styles.starterCardBody}>{sp.body}</pre>
                    <div className={styles.starterCardTags}>
                      {sp.tags.map((tag) => (
                        <span key={tag} className={styles.starterCardTag}>
                          {tag}
                        </span>
                      ))}
                    </div>
                    <button
                      type="button"
                      className={styles.starterCardBtn}
                      disabled={busy || added}
                      onClick={() => addStarter(sp.id, sp.title, sp.body, sp.tags, sp.taskType)}
                    >
                      {added
                        ? t.library.starters.added
                        : busy
                          ? t.library.starters.adding
                          : `+ ${t.library.starters.add}`}
                    </button>
                    {err && <div className={styles.starterCardErr}>{err}</div>}
                  </div>
                )
              })
            })()}
          </div>
        </div>
      ) : items.length === 0 ? (
        <p className={styles.empty}>Нет сохранённых промптов</p>
      ) : (
        <div key={tagPaintTick} className={masonryClass}>
          {sorted.map((item) => {
            const { text: promptText, lang: promptLang } = displayPromptFor(item)
            const hasAlt = Boolean((item.prompt_alt || '').trim())
            const currentView = langView[item.id] || 'primary'
            const otherLang =
              currentView === 'primary'
                ? (item.prompt_alt_lang || '').toUpperCase()
                : (item.prompt_lang || '').toUpperCase()
            const hasCover = Boolean(item.cover_image_path)
            return (
            <div
              key={item.id}
              className={`${styles.card} ${styles.cardMasonry} ${hasCover ? styles.cardWithCover : ''}`}
            >
              {hasCover ? (
                <div className={styles.libHero}>
                  <img
                    className={styles.libHeroImg}
                    src={item.cover_image_path!}
                    alt=""
                    loading="lazy"
                  />
                  <div className={styles.libHeroGrad} aria-hidden />
                  <div className={styles.libHeroOverlay}>
                    <button
                      type="button"
                      className={styles.libHeroTitle}
                      title="Открыть на Студии с этим промптом"
                      onClick={() =>
                        navigate('/home', {
                          state: { prefillTask: `Улучши этот промпт:\n\n${promptText}`, clearResult: true },
                        })
                      }
                    >
                      {item.title}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.cardTitleBtn}
                    title="Открыть на Студии с этим промптом"
                    onClick={() =>
                      navigate('/home', {
                        state: { prefillTask: `Улучши этот промпт:\n\n${promptText}`, clearResult: true },
                      })
                    }
                  >
                    {item.title}
                  </button>
                  {item.created_at ? (
                    <p className={styles.cardDates}>{formatLibraryCardDates(item.created_at, item.updated_at)}</p>
                  ) : null}
                </>
              )}
              <div className={hasCover ? styles.libCardBody : styles.cardBodyFlat}>
              {hasCover && item.created_at ? (
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
                <EvalBadge libraryId={item.id} />
                {item.target_model && item.target_model !== 'unknown' && (
                  <span className={styles.modelBadge} title="Целевая модель">
                    {item.target_model}
                  </span>
                )}
                <span className={styles.ratingBadge} title="Оценка по шкале от 0 до 5 звёзд">
                  {ratingLabel(item.rating)}
                </span>
                <span className={styles.tokenBadgeMini} title="Приблизительное количество токенов">
                  ≈{Math.max(1, Math.round(promptText.length / 3.5)).toLocaleString()} tok
                </span>
                {hasAlt ? (
                  <button
                    type="button"
                    onClick={() =>
                      setLangView((prev) => ({
                        ...prev,
                        [item.id]: currentView === 'primary' ? 'alt' : 'primary',
                      }))
                    }
                    title={`Показать ${otherLang || 'другую'} версию`}
                    style={{
                      fontSize: 10,
                      padding: '1px 7px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.14)',
                      background: 'rgba(255,255,255,0.04)',
                      color: 'inherit',
                      cursor: 'pointer',
                      lineHeight: '16px',
                    }}
                  >
                    {promptLang || (currentView === 'primary' ? 'A' : 'B')} ⇄ {otherLang || '?'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleTranslate(item)}
                    disabled={Boolean(translating[item.id])}
                    title="Перевести RU↔EN (бесплатно, без LLM)"
                    style={{
                      fontSize: 10,
                      padding: '1px 7px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.14)',
                      background: 'rgba(255,255,255,0.04)',
                      color: 'inherit',
                      cursor: translating[item.id] ? 'wait' : 'pointer',
                      lineHeight: '16px',
                      opacity: translating[item.id] ? 0.6 : 1,
                    }}
                  >
                    {translating[item.id] ? '…' : '🌐 RU↔EN'}
                  </button>
                )}
                {translateErr[item.id] ? (
                  <span
                    title={translateErr[item.id]}
                    style={{ fontSize: 10, color: '#f87171' }}
                  >
                    ошибка
                  </span>
                ) : null}
              </p>
              {item.tags.length > 0 ? <LibraryTagChips tags={item.tags} className={styles.tagChipsMargin} /> : null}
              <div className={styles.promptBlock}>
                <pre className={styles.preview}>
                  {promptText.slice(0, 200)}
                  {promptText.length > 200 ? '…' : ''}
                </pre>
              </div>
              <div className={styles.cardActions}>
                <button
                  type="button"
                  className={`${styles.openBtn} ${styles.openBtnAccent} btn-primary`}
                  title="Открыть на Студии с этим промптом"
                  onClick={() =>
                    navigate('/home', { state: { prefillTask: `Улучши этот промпт:\n\n${promptText}`, clearResult: true } })
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
                  prompt={promptText}
                  title={
                    isImagePrompt(item)
                      ? 'Скопировать и открыть чат ИИ (для изображений часто выбирают Gemini)'
                      : 'Скопировать промпт и открыть чат ИИ'
                  }
                />
                <CopyIconButton text={promptText} title="Копировать текст промпта в буфер обмена" />
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
                      className={styles.cardMoreItem}
                      onClick={() =>
                        navigate(
                          { pathname: '/compare', search: '?mode=stability' },
                          {
                            state: {
                              stability: {
                                libraryIdA: item.id,
                                promptA: promptText,
                                taskInput: libraryUserTurnFromCard(item),
                              },
                            },
                          },
                        )
                      }
                    >
                      Стабильность (N-runs)…
                    </button>
                    <button
                      type="button"
                      className={styles.cardMoreItem}
                      onClick={() => setPairStabilityA(item)}
                    >
                      Стабильность пары A+B…
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
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
