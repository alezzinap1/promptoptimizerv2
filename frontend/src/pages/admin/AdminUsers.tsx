import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { api, type AdminUserRow } from '../../api/client'
import { useAuth } from '../../context/AuthContext'

export default function AdminUsers() {
  const { user } = useAuth()
  const [q, setQ] = useState('')
  const [items, setItems] = useState<AdminUserRow[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const limit = 30

  useEffect(() => {
    if (!user?.is_admin) return
    let cancelled = false
    api
      .adminListUsers({ q: q.trim() || undefined, limit, offset })
      .then((r) => {
        if (!cancelled) {
          setItems(r.items)
          setTotal(r.total)
        }
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Ошибка')
      })
    return () => {
      cancelled = true
    }
  }, [user?.is_admin, q, offset])

  if (!user?.is_admin) return <Navigate to="/home" replace />

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <h1 className="pageTitleGradient" style={{ marginBottom: 16 }}>
        Админка — пользователи
      </h1>
      <p style={{ opacity: 0.85, marginBottom: 20 }}>
        Поиск по имени, email или числовому id. События и лимиты без текста промптов.
      </p>
      {err ? <p style={{ color: 'var(--danger, #f87171)' }}>{err}</p> : null}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setOffset(0)
            setQ(e.target.value)
          }}
          placeholder="Поиск…"
          style={{ flex: '1 1 200px', padding: '8px 12px', borderRadius: 8 }}
        />
      </div>
      <div style={{ opacity: 0.8, marginBottom: 8 }}>
        Всего: {total}
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
            <th style={{ padding: '8px 4px' }}>id</th>
            <th style={{ padding: '8px 4px' }}>Логин</th>
            <th style={{ padding: '8px 4px' }}>Email</th>
            <th style={{ padding: '8px 4px' }}>Активность</th>
            <th style={{ padding: '8px 4px' }}>Токены</th>
            <th style={{ padding: '8px 4px' }}>$ (оценка)</th>
            <th style={{ padding: '8px 4px' }}>Флаги</th>
            <th style={{ padding: '8px 4px' }} />
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <td style={{ padding: '8px 4px' }}>{row.id}</td>
              <td style={{ padding: '8px 4px' }}>{row.username}</td>
              <td style={{ padding: '8px 4px' }}>{row.email || '—'}</td>
              <td style={{ padding: '8px 4px' }}>{row.last_active_at || '—'}</td>
              <td style={{ padding: '8px 4px' }}>{row.tokens_used ?? 0}</td>
              <td style={{ padding: '8px 4px' }}>
                {row.dollars_used != null ? Number(row.dollars_used).toFixed(4) : '0'}
              </td>
              <td style={{ padding: '8px 4px' }}>
                {row.is_blocked ? <span style={{ color: '#f87171' }}>blocked</span> : 'ok'}
                {row.is_admin ? <span style={{ marginLeft: 8, color: '#93c5fd' }}>admin</span> : null}
              </td>
              <td style={{ padding: '8px 4px' }}>
                <Link to={`/admin/users/${row.id}`}>Открыть</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
          Назад
        </button>
        <button type="button" disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
          Вперёд
        </button>
      </div>
    </div>
  )
}
