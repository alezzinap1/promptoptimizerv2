import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { api, type AdminCommunityPromptRow } from '../../api/client'
import { useAuth } from '../../context/AuthContext'

type Visibility = 'all' | 'public' | 'hidden'

export default function AdminCommunity() {
  const { user } = useAuth()
  const [visibility, setVisibility] = useState<Visibility>('all')
  const [items, setItems] = useState<AdminCommunityPromptRow[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const limit = 25

  useEffect(() => {
    if (!user?.is_admin) return
    let cancelled = false
    setErr(null)
    api
      .adminListCommunity({ visibility, limit, offset })
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
  }, [user?.is_admin, visibility, offset])

  if (!user?.is_admin) return <Navigate to="/home" replace />

  const setPublic = async (id: number, is_public: 0 | 1) => {
    setBusyId(id)
    setErr(null)
    try {
      await api.adminPatchCommunityPublic(id, is_public)
      const r = await api.adminListCommunity({ visibility, limit, offset })
      setItems(r.items)
      setTotal(r.total)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setBusyId(null)
    }
  }

  const maxPage = Math.max(0, Math.ceil(total / limit) - 1)
  const page = Math.floor(offset / limit)

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
        <h1 className="pageTitleGradient">Админ — лента сообщества</h1>
        <div style={{ display: 'flex', gap: 14, fontSize: 14 }}>
          <Link to="/admin">Дашборд</Link>
          <Link to="/admin/users">Пользователи</Link>
          <Link to="/community">Открыть ленту</Link>
        </div>
      </div>
      <p style={{ opacity: 0.85, marginTop: 10, marginBottom: 16, maxWidth: 720 }}>
        Скрытые посты (<code>is_public = 0</code>) не показываются в публичной ленте. Автор по-прежнему может удалить свой
        пост из интерфейса ленты.
      </p>
      {err ? <p style={{ color: 'var(--danger, #f87171)' }}>{err}</p> : null}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['all', 'public', 'hidden'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => {
              setOffset(0)
              setVisibility(v)
            }}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: visibility === v ? '1px solid var(--primary, #38bdf8)' : '1px solid rgba(255,255,255,0.12)',
              background: visibility === v ? 'color-mix(in srgb, var(--primary) 18%, transparent)' : 'transparent',
              cursor: 'pointer',
              fontWeight: visibility === v ? 600 : 400,
            }}
          >
            {v === 'all' ? 'Все' : v === 'public' ? 'В ленте' : 'Скрытые'}
          </button>
        ))}
        <span style={{ opacity: 0.75, marginLeft: 8 }}>Всего записей: {total}</span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
            <th style={{ padding: '8px 6px' }}>id</th>
            <th style={{ padding: '8px 6px' }}>Заголовок</th>
            <th style={{ padding: '8px 6px' }}>Автор</th>
            <th style={{ padding: '8px 6px' }}>Лента</th>
            <th style={{ padding: '8px 6px' }}>Действия</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', verticalAlign: 'top' }}>
              <td style={{ padding: '10px 6px', whiteSpace: 'nowrap' }}>{row.id}</td>
              <td style={{ padding: '10px 6px', maxWidth: 280 }}>
                <strong style={{ display: 'block', marginBottom: 4 }}>{row.title}</strong>
                <details style={{ fontSize: 12, opacity: 0.85 }}>
                  <summary style={{ cursor: 'pointer' }}>Текст промпта</summary>
                  <pre
                    style={{
                      margin: '8px 0 0',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      maxHeight: 200,
                      overflow: 'auto',
                      fontSize: 11,
                    }}
                  >
                    {row.prompt}
                  </pre>
                </details>
              </td>
              <td style={{ padding: '10px 6px' }}>
                {row.author_name || '—'}
                <div style={{ fontSize: 11, opacity: 0.6 }}>user #{row.author_user_id}</div>
              </td>
              <td style={{ padding: '10px 6px' }}>{row.is_public ? 'да' : 'нет'}</td>
              <td style={{ padding: '10px 6px' }}>
                {row.is_public ? (
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => void setPublic(row.id, 0)}
                    style={{ padding: '6px 10px', borderRadius: 6, cursor: busyId === row.id ? 'wait' : 'pointer' }}
                  >
                    Скрыть из ленты
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => void setPublic(row.id, 1)}
                    style={{ padding: '6px 10px', borderRadius: 6, cursor: busyId === row.id ? 'wait' : 'pointer' }}
                  >
                    Показать в ленте
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {total > limit ? (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 20 }}>
          <button
            type="button"
            disabled={page <= 0}
            onClick={() => setOffset((p) => Math.max(0, p - limit))}
            style={{ padding: '8px 14px', borderRadius: 8 }}
          >
            Назад
          </button>
          <span style={{ opacity: 0.8 }}>
            Стр. {page + 1} / {maxPage + 1}
          </span>
          <button
            type="button"
            disabled={page >= maxPage}
            onClick={() => setOffset((p) => p + limit)}
            style={{ padding: '8px 14px', borderRadius: 8 }}
          >
            Вперёд
          </button>
        </div>
      ) : null}
    </div>
  )
}
