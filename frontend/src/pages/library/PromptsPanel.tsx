import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type LibraryItem } from '../../api/client'
import SelectDropdown from '../../components/SelectDropdown'
import { CopyIconButton, DownloadIconButton, PencilIconButton, TrashIconButton } from '../../components/PromptToolbarIcons'
import { formatLibraryCardDates } from '../../lib/promptLibraryMeta'
import styles from '../Library.module.css'

function ratingLabel(rating: number | undefined | null) {
  const r = rating ?? 0
  if (r <= 0) return 'Нет оценки'
  return `★ ${r}/5`
}

type Props = {
  onPromptCountChanged?: () => void
}

export default function PromptsPanel({ onPromptCountChanged }: Props) {
  const navigate = useNavigate()
  const [items, setItems] = useState<LibraryItem[]>([])
  const [stats, setStats] = useState<{ total: number; models?: string[]; task_types?: string[] }>({ total: 0 })
  const [search, setSearch] = useState('')
  const [taskType, setTaskType] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [drafts, setDrafts] = useState<Record<number, { title: string; tags: string; notes: string; rating: number }>>({})

  useEffect(() => {
    api.getLibraryStats().then(setStats)
  }, [])

  useEffect(() => {
    setLoading(true)
    setError(null)
    api.getLibrary({
      search: search || undefined,
      task_type: taskType !== 'all' ? taskType : undefined,
    })
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }, [search, taskType])

  const exportText = useMemo(
    () =>
      items
        .map((item) => `# ${item.title}\n# tags: ${item.tags.join(', ')}\n\n${item.prompt}`)
        .join('\n\n' + '='.repeat(60) + '\n\n'),
    [items],
  )

  const taskTypeOptions = useMemo(
    () => [
      { value: 'all', label: 'Все типы' },
      ...(stats.task_types || []).map((item) => ({ value: item, label: item })),
    ],
    [stats.task_types],
  )

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
  }

  return (
    <div className={styles.library}>
      <div className={styles.header}>
        <h2 className="pageTitleGradient">Промпты</h2>
      </div>

      <div className={styles.toolbar}>
        <input
          type="search"
          placeholder="Поиск..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={styles.search}
        />
        <SelectDropdown
          value={taskType}
          options={taskTypeOptions}
          onChange={setTaskType}
          aria-label="Тип задачи"
          variant="toolbar"
          className={styles.toolbarSelect}
        />
        <button
          type="button"
          className={`${styles.exportBtn} btn-ghost`}
          title="Скачать один .txt со всеми промптами из текущего списка (с учётом поиска и фильтра)"
          onClick={() => {
            const blob = new Blob([exportText], { type: 'text/plain;charset=utf-8' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = 'prompt_library.txt'
            a.click()
            URL.revokeObjectURL(url)
          }}
        >
          Экспорт всех
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {loading ? (
        <p>Загрузка...</p>
      ) : items.length === 0 ? (
        <p className={styles.empty}>Нет сохранённых промптов</p>
      ) : (
        <div className={styles.grid}>
          {items.map((item) => (
            <div key={item.id} className={styles.card}>
              <h3 className={styles.cardTitle}>{item.title}</h3>
              {item.created_at ? (
                <p className={styles.cardDates}>{formatLibraryCardDates(item.created_at, item.updated_at)}</p>
              ) : null}
              <p className={styles.meta}>
                <span className={styles.taskTypeLabel} title="Тип задачи при сохранении">
                  {item.task_type}
                </span>
                <span className={styles.ratingBadge} title="Оценка по шкале от 0 до 5 звёзд">
                  {ratingLabel(item.rating)}
                </span>
              </p>
              {item.tags.length > 0 && <p className={styles.tags}>{item.tags.join(', ')}</p>}
              <div className={styles.promptBlock}>
                <pre className={styles.preview}>
                  {item.prompt.slice(0, 200)}
                  {item.prompt.length > 200 ? '…' : ''}
                </pre>
              </div>
              <div className={styles.cardActions}>
                <button
                  type="button"
                  className={`${styles.openBtn} btn-primary`}
                  title="Открыть на главной и улучшить этот промпт"
                  onClick={() =>
                    navigate('/home', { state: { prefillTask: `Улучши этот промпт:\n\n${item.prompt}`, clearResult: true } })
                  }
                >
                  Открыть
                </button>
                <CopyIconButton text={item.prompt} title="Копировать текст промпта в буфер обмена" />
                <DownloadIconButton
                  title="Скачать этот промпт одним .txt файлом на диск"
                  onClick={() => {
                    const blob = new Blob([item.prompt], { type: 'text/plain;charset=utf-8' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `prompt_${item.id}.txt`
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                />
                <PencilIconButton title="Редактировать название, теги, заметки и оценку" onClick={() => startEdit(item)} />
                <TrashIconButton
                  title="Удалить запись из библиотеки без восстановления"
                  onClick={async () => {
                    await api.deleteLibrary(item.id)
                    setItems((prev) => prev.filter((x) => x.id !== item.id))
                    api.getLibraryStats().then(setStats)
                    onPromptCountChanged?.()
                  }}
                />
              </div>
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
                    placeholder="Теги"
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
