import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type CommunityPrompt } from '../api/client'
import PublishToCommunityModal from '../components/PublishToCommunityModal'
import { useAuth } from '../context/AuthContext'
import styles from './Community.module.css'

const TYPES = [
  { value: '', label: 'Все типы' },
  { value: 'text', label: 'Текст' },
  { value: 'image', label: 'Изображения' },
  { value: 'skill', label: 'Скиллы' },
]

const SORTS = [
  { value: 'newest', label: 'Новые' },
  { value: 'popular', label: 'Популярные' },
  { value: 'top', label: 'Топ' },
]

export default function Community() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [items, setItems] = useState<CommunityPrompt[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState('')
  const [sortBy, setSortBy] = useState('newest')
  const [search, setSearch] = useState('')
  const [publishOpen, setPublishOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (typeFilter) params.prompt_type = typeFilter
      if (sortBy) params.sort = sortBy
      if (search.trim()) params.search = search.trim()
      const r = await api.getCommunity(params)
      setItems(r.items)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [typeFilter, sortBy, search])

  useEffect(() => {
    load()
  }, [load])

  const handleVote = async (id: number) => {
    try {
      const r = await api.voteCommunityPrompt(id)
      setItems((prev) =>
        prev.map((it) =>
          it.id === id
            ? { ...it, voted: r.voted, upvotes: it.upvotes + (r.voted ? 1 : -1) }
            : it,
        ),
      )
    } catch { /* ignore */ }
  }

  const handleUse = (prompt: string) => {
    navigate('/home', { state: { prefillTask: prompt } })
  }

  const handleDeleteMine = async (id: number) => {
    if (!window.confirm('Убрать эту публикацию с ленты?')) return
    try {
      await api.deleteCommunityPrompt(id)
      setItems((prev) => prev.filter((it) => it.id !== id))
    } catch {
      window.alert('Не удалось удалить. Попробуйте ещё раз.')
    }
  }

  const isMine = (it: CommunityPrompt) =>
    Boolean(user && user.id > 0 && it.author_user_id === user.id)

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className="pageTitleGradient">Сообщество</h1>
          <button type="button" className={styles.publishHeaderBtn} onClick={() => setPublishOpen(true)}>
            + Публикация
          </button>
        </div>
        <div className={styles.filters}>
          <input
            className={styles.searchInput}
            placeholder="Поиск…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className={styles.filterSelect} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <select className={styles.filterSelect} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && <div className={styles.empty}>Загрузка…</div>}

      <div className={styles.masonry}>
        {!loading && items.length === 0 && (
          <div className={styles.emptyStateWrap}>
            <div className={styles.emptyPromo}>
              <p className={styles.emptyPromoText}>
                Здесь будет живая лента: делитесь промптами — другие найдут их через поиск и смогут использовать у себя.
              </p>
              <button type="button" className={styles.emptyPromoBtn} onClick={() => setPublishOpen(true)}>
                Опубликовать первым
              </button>
            </div>
            <div className={styles.ghostRow}>
              <div className={styles.ghostCard} aria-hidden />
              <div className={styles.ghostCard} aria-hidden />
            </div>
          </div>
        )}
        {items.map((item) =>
          item.image_path ? (
            <div key={item.id} className={`${styles.card} ${styles.cardWithImage}`}>
              <div className={styles.cardHero}>
                <img className={styles.cardHeroImg} src={item.image_path} alt="" loading="lazy" />
                <div className={styles.cardHeroGradient} aria-hidden />
                <div className={styles.cardHeroOverlay}>
                  <h3 className={styles.cardTitleOverlay}>{item.title}</h3>
                  {item.description ? (
                    <p className={styles.cardDescOverlay}>{item.description}</p>
                  ) : null}
                </div>
              </div>
              <div className={styles.cardBody}>
                <div className={styles.promptPreview}>{item.prompt.slice(0, 200)}</div>
                <div className={styles.cardMeta}>
                  <span className={styles.typeBadge}>{item.prompt_type}</span>
                  {item.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className={styles.tag}>{tag}</span>
                  ))}
                </div>
                <div className={styles.cardFooter}>
                  <span className={styles.author}>@{item.author_name || 'anon'}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className={`${styles.voteBtn} ${item.voted ? styles.voteBtnActive : ''}`}
                      onClick={() => handleVote(item.id)}
                      title="Голос"
                      type="button"
                    >
                      ▲ {item.upvotes}
                    </button>
                    <button
                      type="button"
                      className={styles.useBtn}
                      onClick={() => handleUse(item.prompt)}
                    >
                      Использовать
                    </button>
                    {isMine(item) ? (
                      <button
                        type="button"
                        className={styles.deleteMineBtn}
                        onClick={() => void handleDeleteMine(item.id)}
                        title="Снять с публикации"
                      >
                        Убрать
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div key={item.id} className={styles.card}>
              <h3 className={styles.cardTitle}>{item.title}</h3>
              {item.description && <p className={styles.cardDesc}>{item.description}</p>}
              <div className={styles.promptPreview}>{item.prompt.slice(0, 200)}</div>
              <div className={styles.cardMeta}>
                <span className={styles.typeBadge}>{item.prompt_type}</span>
                {item.tags.slice(0, 3).map((tag) => (
                  <span key={tag} className={styles.tag}>{tag}</span>
                ))}
              </div>
              <div className={styles.cardFooter}>
                <span className={styles.author}>@{item.author_name || 'anon'}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className={`${styles.voteBtn} ${item.voted ? styles.voteBtnActive : ''}`}
                    onClick={() => handleVote(item.id)}
                    title="Голос"
                  >
                    ▲ {item.upvotes}
                  </button>
                  <button type="button" className={styles.useBtn} onClick={() => handleUse(item.prompt)}>
                    Использовать
                  </button>
                  {isMine(item) ? (
                    <button
                      type="button"
                      className={styles.deleteMineBtn}
                      onClick={() => void handleDeleteMine(item.id)}
                      title="Снять с публикации"
                    >
                      Убрать
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ),
        )}
      </div>

      <PublishToCommunityModal
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        initial={{ title: '', prompt: '', description: '', prompt_type: 'text', tags: [] }}
        onPublished={() => load()}
      />
    </div>
  )
}
