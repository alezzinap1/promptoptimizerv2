import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { api, type AdminUserEvent } from '../../api/client'
import { useAuth } from '../../context/AuthContext'

export default function AdminUserDetail() {
  const { userId } = useParams()
  const { user } = useAuth()
  const id = Number(userId)
  const [detail, setDetail] = useState<{
    user: Record<string, unknown>
    usage: Record<string, unknown>
    trial: Record<string, unknown>
  } | null>(null)
  const [events, setEvents] = useState<AdminUserEvent[]>([])
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!user?.is_admin || !Number.isFinite(id) || id <= 0) return
    let cancelled = false
    Promise.all([api.adminGetUser(id), api.adminUserEvents(id, 80)])
      .then(([d, ev]) => {
        if (!cancelled) {
          setDetail(d)
          setEvents(ev.events)
        }
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Ошибка')
      })
    return () => {
      cancelled = true
    }
  }, [user?.is_admin, id])

  if (!user?.is_admin) return <Navigate to="/home" replace />
  if (!Number.isFinite(id) || id <= 0) return <Navigate to="/admin" replace />

  const reload = () => {
    setErr(null)
    Promise.all([api.adminGetUser(id), api.adminUserEvents(id, 80)])
      .then(([d, ev]) => {
        setDetail(d)
        setEvents(ev.events)
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Ошибка'))
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <p>
        <Link to="/admin">← К списку</Link>
      </p>
      <h1 className="pageTitleGradient" style={{ marginBottom: 16 }}>
        Пользователь #{id}
      </h1>
      {err ? <p style={{ color: 'var(--danger, #f87171)' }}>{err}</p> : null}
      {!detail ? <p>Загрузка…</p> : null}
      {detail ? (
        <>
          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: '1.1rem', marginBottom: 8 }}>Профиль</h2>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, opacity: 0.9 }}>
              {JSON.stringify(detail.user, null, 2)}
            </pre>
          </section>
          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: '1.1rem', marginBottom: 8 }}>Использование / trial</h2>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, opacity: 0.9 }}>
              {JSON.stringify({ usage: detail.usage, trial: detail.trial }, null, 2)}
            </pre>
          </section>
          <section style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
            <button
              type="button"
              onClick={() =>
                api.adminBlockUser(id).then(reload).catch((e) => setErr(String(e)))
              }
            >
              Заблокировать
            </button>
            <button
              type="button"
              onClick={() =>
                api.adminUnblockUser(id).then(reload).catch((e) => setErr(String(e)))
              }
            >
              Разблокировать
            </button>
            <button
              type="button"
              onClick={() =>
                api.adminResetTrialUsage(id).then(reload).catch((e) => setErr(String(e)))
              }
            >
              Сбросить trial usage
            </button>
          </section>
          <section>
            <h2 style={{ fontSize: '1.1rem', marginBottom: 8 }}>События (санитизированные)</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
                  <th style={{ padding: 4 }}>Время</th>
                  <th style={{ padding: 4 }}>Событие</th>
                  <th style={{ padding: 4 }}>Payload</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={`${e.event_name}-${i}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <td style={{ padding: 6, verticalAlign: 'top' }}>{e.created_at || '—'}</td>
                    <td style={{ padding: 6, verticalAlign: 'top' }}>{e.event_name}</td>
                    <td style={{ padding: 6, verticalAlign: 'top', wordBreak: 'break-word' }}>
                      {JSON.stringify(e.payload)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : null}
    </div>
  )
}
