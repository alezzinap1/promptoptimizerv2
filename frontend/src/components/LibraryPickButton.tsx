import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { api, type LibraryItem, type LibraryRevision } from '../api/client'
import {
  libraryPromptText,
  libraryTaskDescriptionFromCard,
  libraryUserTurnFromCard,
} from '../lib/libraryPickText'
import { formatLibraryCardDates } from '../lib/promptLibraryMeta'
import LibraryTagChips from './LibraryTagChips'
import LibraryRevisionStrip from './LibraryRevisionStrip'
import ThemedTooltip from './ThemedTooltip'
import EvalBadge from '../pages/eval/EvalBadge'
import libStyles from '../pages/Library.module.css'
import styles from './LibraryPickButton.module.css'

export type LibraryPickApplyMode = 'prompt' | 'task' | 'user_turn'

type Props = {
  applyMode: LibraryPickApplyMode
  onApply: (text: string) => void
  disabled?: boolean
  className?: string
  buttonClassName?: string
}

const IMAGE_SIGNALS = [
  'image',
  'картинк',
  'изображен',
  'midjourney',
  'dall-e',
  'dalle',
  'stable diffusion',
  'генерац',
  'иллюстрац',
  'фото',
  'photo',
  'visual',
  'art',
  'рисунок',
  'рисов',
]

function isImagePrompt(item: LibraryItem): boolean {
  const text = `${item.title} ${(item.tags || []).join(' ')} ${item.task_type} ${item.prompt.slice(0, 300)}`.toLowerCase()
  return IMAGE_SIGNALS.some((s) => text.includes(s))
}

function ratingLabel(rating: number | undefined | null): string {
  const r = rating ?? 0
  if (r <= 0) return 'Нет оценки'
  return `★ ${r}/5`
}

function modalTitle(mode: LibraryPickApplyMode): string {
  if (mode === 'prompt') return 'Библиотека промптов'
  if (mode === 'task') return 'Текст задачи из карточки'
  return 'Сообщение пользователя из карточки'
}

function modalLead(mode: LibraryPickApplyMode): string {
  if (mode === 'prompt') return 'Как в библиотеке. Нажмите карточку — текст попадёт в поле сравнения.'
  if (mode === 'task') return 'Подставятся заметки или краткая формулировка по заголовку — не полный промпт.'
  return 'Подставятся заметки или нейтральная заготовка для теста.'
}

function textForApplied(
  item: LibraryItem,
  mode: LibraryPickApplyMode,
  langView: Record<number, 'primary' | 'alt'>,
): string {
  if (mode === 'prompt') {
    const v = langView[item.id] || 'primary'
    if (v === 'alt' && (item.prompt_alt || '').trim()) return (item.prompt_alt || '').trim()
    return libraryPromptText(item)
  }
  if (mode === 'task') return libraryTaskDescriptionFromCard(item)
  return libraryUserTurnFromCard(item)
}

function IconLibrary() {
  return (
    <svg className={styles.triggerIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 6h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 10h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 6h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 10h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export default function LibraryPickButton({
  applyMode,
  onApply,
  disabled,
  className,
  buttonClassName,
}: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [items, setItems] = useState<LibraryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [langView, setLangView] = useState<Record<number, 'primary' | 'alt'>>({})
  const [translating, setTranslating] = useState<Record<number, boolean>>({})
  const [translateErr, setTranslateErr] = useState<Record<number, string>>({})
  const [expandedPickId, setExpandedPickId] = useState<number | null>(null)
  const [revCache, setRevCache] = useState<Record<number, LibraryRevision[]>>({})
  const [revLoading, setRevLoading] = useState<number | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const h = window.setTimeout(() => setDebouncedSearch(search), 200)
    return () => window.clearTimeout(h)
  }, [search])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(null)
    let cancelled = false
    api
      .getLibrary({ search: debouncedSearch.trim() || undefined })
      .then((r) => {
        if (!cancelled) setItems(r.items)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Ошибка загрузки')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, debouncedSearch])

  useEffect(() => {
    if (!open) return
    setSearch('')
    setDebouncedSearch('')
    setError(null)
    setLangView({})
    setTranslating({})
    setTranslateErr({})
    setExpandedPickId(null)
    setRevCache({})
    setRevLoading(null)
    const t = window.setTimeout(() => searchRef.current?.focus(), 50)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    if (open) modalRef.current?.focus()
  }, [open])

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

  const pick = (item: LibraryItem) => {
    onApply(textForApplied(item, applyMode, langView))
    setOpen(false)
  }

  const loadRevisionsForPick = async (itemId: number) => {
    if (revCache[itemId]) return
    setRevLoading(itemId)
    try {
      const r = await api.getLibraryRevisions(itemId)
      setRevCache((c) => ({ ...c, [itemId]: r.items }))
    } finally {
      setRevLoading(null)
    }
  }

  const patchStars = (itemId: number, starId: number | null) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== itemId || !it.revisions?.length) return it
        return {
          ...it,
          revisions: it.revisions.map((x) => ({
            ...x,
            is_starred: starId != null && x.id === starId,
          })),
        }
      }),
    )
    setRevCache((c) => {
      const list = c[itemId]
      if (!list) return c
      return {
        ...c,
        [itemId]: list.map((x) => ({
          ...x,
          is_starred: starId != null && x.id === starId,
        })),
      }
    })
  }

  const handleStarPick = async (itemId: number, revisionId: number, isCurrentlyStarred: boolean) => {
    const next = isCurrentlyStarred ? null : revisionId
    await api.starLibraryRevision(itemId, next)
    patchStars(itemId, next)
  }

  const stop = (e: React.MouseEvent) => e.stopPropagation()

  const modal =
    open &&
    createPortal(
      <div className={styles.overlay} onClick={() => setOpen(false)} role="presentation">
        <div
          ref={modalRef}
          className={styles.modal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="library-pick-title"
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={styles.head}>
            <h2 id="library-pick-title" className={styles.title}>
              {modalTitle(applyMode)}
            </h2>
            <p className={styles.lead}>{modalLead(applyMode)}</p>
          </div>
          <div className={styles.search}>
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по названию, тегам, тексту…"
              autoComplete="off"
            />
          </div>
          {error ? <div className={styles.err}>{error}</div> : null}
          <div className={`${libStyles.masonry} ${styles.pickModalBody}`}>
            {loading ? (
              <div className={styles.empty}>Загрузка…</div>
            ) : items.length === 0 ? (
              <div className={styles.empty}>
                {debouncedSearch.trim() ? 'Ничего не найдено.' : 'Библиотека пуста или недоступна.'}
              </div>
            ) : (
              items.map((item) => {
                const { text: promptText, lang: promptLang } = displayPromptFor(item)
                const hasAlt = Boolean((item.prompt_alt || '').trim())
                const currentView = langView[item.id] || 'primary'
                const otherLang =
                  currentView === 'primary'
                    ? (item.prompt_alt_lang || '').toUpperCase()
                    : (item.prompt_lang || '').toUpperCase()
                const hasCover = Boolean(item.cover_image_path)
                const tt = (item.task_type || '').trim()
                const tm = (item.target_model || '').trim()

                const revCount = item.revisions?.length ?? 0
                const multiPromptPick = applyMode === 'prompt' && revCount > 1

                return (
                  <article
                    key={item.id}
                    className={`${libStyles.card} ${libStyles.cardMasonry} ${hasCover ? libStyles.cardWithCover : ''} ${styles.pickCardWrap} ${expandedPickId === item.id ? styles.pickCardExpanded : ''}`}
                    onClick={() => {
                      if (!multiPromptPick) {
                        pick(item)
                        return
                      }
                      if (expandedPickId === item.id) {
                        setExpandedPickId(null)
                        return
                      }
                      setExpandedPickId(item.id)
                      void loadRevisionsForPick(item.id)
                    }}
                  >
                    {hasCover ? (
                      <div className={libStyles.libHero}>
                        <img
                          className={libStyles.libHeroImg}
                          src={item.cover_image_path!}
                          alt=""
                          loading="lazy"
                        />
                        <div className={libStyles.libHeroGrad} aria-hidden />
                        <div className={libStyles.libHeroOverlay}>
                          <div className={`${libStyles.libHeroTitle} ${styles.pickCardTitleStatic}`}>{item.title}</div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className={`${libStyles.cardTitleBtn} ${styles.pickCardTitleStatic}`}>{item.title}</div>
                        {item.created_at ? (
                          <p className={libStyles.cardDates}>
                            {formatLibraryCardDates(item.created_at, item.updated_at || item.created_at)}
                          </p>
                        ) : null}
                      </>
                    )}
                    <div className={hasCover ? libStyles.libCardBody : libStyles.cardBodyFlat}>
                      {hasCover && item.created_at ? (
                        <p className={libStyles.cardDates}>
                          {formatLibraryCardDates(item.created_at, item.updated_at)}
                        </p>
                      ) : null}
                      <p className={libStyles.meta}>
                        {tt ? (
                          <ThemedTooltip content="Тип задачи при сохранении" side="top" delayMs={200}>
                            <span className={libStyles.taskTypeLabel}>{tt}</span>
                          </ThemedTooltip>
                        ) : null}
                        {isImagePrompt(item) && (
                          <ThemedTooltip content="Промпт для генерации изображений" side="top" delayMs={200}>
                            <span className={libStyles.imageBadge}>🎨</span>
                          </ThemedTooltip>
                        )}
                        <EvalBadge libraryId={item.id} />
                        {tm && tm !== 'unknown' && (
                          <ThemedTooltip content="Целевая модель" side="top" delayMs={200}>
                            <span className={libStyles.modelBadge}>{tm}</span>
                          </ThemedTooltip>
                        )}
                        <ThemedTooltip content="Оценка по шкале от 0 до 5 звёзд" side="top" delayMs={200}>
                          <span className={libStyles.ratingBadge}>{ratingLabel(item.rating)}</span>
                        </ThemedTooltip>
                        <ThemedTooltip content="Приблизительное количество токенов" side="top" delayMs={200}>
                          <span className={libStyles.tokenBadgeMini}>
                            ≈{Math.max(1, Math.round(promptText.length / 3.5)).toLocaleString('ru')} tok
                          </span>
                        </ThemedTooltip>
                        {applyMode === 'prompt' ? (
                          hasAlt ? (
                            <ThemedTooltip content={`Показать ${otherLang || 'другую'} версию`} side="top" delayMs={200}>
                              <button
                                type="button"
                                onClick={(e) => {
                                  stop(e)
                                  setLangView((prev) => ({
                                    ...prev,
                                    [item.id]: currentView === 'primary' ? 'alt' : 'primary',
                                  }))
                                }}
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
                            </ThemedTooltip>
                          ) : (
                            <ThemedTooltip content="Перевести RU↔EN (бесплатно, без LLM)" side="top" delayMs={200}>
                              <span style={{ display: 'inline-block' }}>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    stop(e)
                                    void handleTranslate(item)
                                  }}
                                  disabled={Boolean(translating[item.id])}
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
                              </span>
                            </ThemedTooltip>
                          )
                        ) : null}
                        {translateErr[item.id] ? (
                          <ThemedTooltip content={translateErr[item.id]} side="top" delayMs={200}>
                            <span style={{ fontSize: 10, color: '#f87171' }}>ошибка</span>
                          </ThemedTooltip>
                        ) : null}
                      </p>
                      {(item.tags || []).length > 0 ? (
                        <LibraryTagChips tags={item.tags} displayOnly className={libStyles.tagChipsMargin} />
                      ) : null}
                      {(item.notes || '').trim() ? (
                        <div className={styles.pickNotes}>
                          <span className={styles.pickNotesLabel}>Заметки / цель</span>
                          <div className={styles.pickNotesText}>{(item.notes || '').trim()}</div>
                        </div>
                      ) : null}
                      <div className={libStyles.promptBlock}>
                        <pre className={`${libStyles.preview} ${styles.modalPreview}`}>
                          {promptText.slice(0, 200)}
                          {promptText.length > 200 ? '…' : ''}
                        </pre>
                      </div>
                      {item.revisions && item.revisions.length > 0 ? (
                        <div onClick={stop}>
                          {revLoading === item.id ? (
                            <p className={styles.revLoading}>Загрузка версий…</p>
                          ) : expandedPickId === item.id && multiPromptPick ? (
                            <LibraryRevisionStrip
                              libraryId={item.id}
                              revisions={item.revisions}
                              showMultiVersionHint
                              pickMode
                              onPickVersion={(seq) => {
                                const row = revCache[item.id]?.find((x) => x.version_seq === seq)
                                onApply(row?.prompt ?? item.prompt)
                                setOpen(false)
                                setExpandedPickId(null)
                              }}
                              onStarRevision={(rid, st) => void handleStarPick(item.id, rid, st)}
                            />
                          ) : (
                            <>
                              <LibraryRevisionStrip
                                libraryId={item.id}
                                revisions={item.revisions}
                                showMultiVersionHint
                                onStarRevision={(rid, st) => void handleStarPick(item.id, rid, st)}
                              />
                              {multiPromptPick ? (
                                <p className={styles.pickExpandHint}>Нажмите карточку — выбрать версию для подстановки.</p>
                              ) : null}
                            </>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </article>
                )
              })
            )}
          </div>
          <div className={styles.foot}>
            <Link to="/library" onClick={() => setOpen(false)}>
              Открыть библиотеку
            </Link>
            <button type="button" className={styles.closeGhost} onClick={() => setOpen(false)}>
              Закрыть
            </button>
          </div>
        </div>
      </div>,
      document.body,
    )

  return (
    <span className={`${styles.wrap} ${className || ''}`.trim()}>
      <button
        type="button"
        className={`${styles.trigger} ${buttonClassName || ''}`.trim()}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <IconLibrary />
        Из библиотеки
      </button>
      {modal}
    </span>
  )
}
