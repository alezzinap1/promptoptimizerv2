import { useState, useEffect } from 'react'
import { api } from '../api/client'
import styles from './Library.module.css'

interface LibraryItem {
  id: number
  title: string
  prompt: string
  tags: string[]
  target_model: string
  task_type: string
  rating: number
  created_at: string
}

export default function Library() {
  const [items, setItems] = useState<LibraryItem[]>([])
  const [stats, setStats] = useState<{ total: number }>({ total: 0 })
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getLibraryStats().then(setStats)
  }, [])

  useEffect(() => {
    setLoading(true)
    api.getLibrary({ search: search || undefined })
      .then((r) => setItems((r.items as LibraryItem[])))
      .finally(() => setLoading(false))
  }, [search])

  return (
    <div className={styles.library}>
      <div className={styles.header}>
        <h1>Библиотека промптов</h1>
        <span className={styles.metric}>Промптов: {stats.total}</span>
      </div>

      <div className={styles.toolbar}>
        <input
          type="search"
          placeholder="Поиск..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={styles.search}
        />
      </div>

      {loading ? (
        <p>Загрузка...</p>
      ) : items.length === 0 ? (
        <p className={styles.empty}>Нет сохранённых промптов</p>
      ) : (
        <div className={styles.grid}>
          {items.map((item) => (
            <div key={item.id} className={styles.card}>
              <h3>{item.title}</h3>
              <p className={styles.meta}>{item.task_type} · {item.target_model}</p>
              <pre className={styles.preview}>{item.prompt.slice(0, 200)}...</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
