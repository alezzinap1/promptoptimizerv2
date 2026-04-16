import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { api, type AdminMetrics, type AdminModelHealth } from '../../api/client'
import { useAuth } from '../../context/AuthContext'

function formatNum(n: number): string {
  return n.toLocaleString('ru-RU')
}

function formatDollars(n: number): string {
  return `$${n.toFixed(4)}`
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div
      style={{
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10,
        padding: '12px 14px',
        background: 'rgba(255,255,255,0.02)',
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 600 }}>{value}</div>
      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>{label}</div>
      {hint ? <div style={{ fontSize: 11, opacity: 0.55, marginTop: 2 }}>{hint}</div> : null}
    </div>
  )
}

export default function AdminDashboard() {
  const { user } = useAuth()
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null)
  const [health, setHealth] = useState<AdminModelHealth | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => {
    setErr(null)
    Promise.all([api.adminMetrics(), api.adminModelHealth()])
      .then(([m, h]) => {
        setMetrics(m)
        setHealth(h)
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Ошибка'))
  }

  useEffect(() => {
    if (!user?.is_admin) return
    load()
  }, [user?.is_admin])

  if (!user?.is_admin) return <Navigate to="/home" replace />

  const runHealthNow = () => {
    setBusy(true)
    api
      .adminRunModelHealth()
      .then(() => load())
      .catch((e) => setErr(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setBusy(false))
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <h1 className="pageTitleGradient">Админ · Дашборд</h1>
        <div style={{ display: 'flex', gap: 12, fontSize: 13 }}>
          <Link to="/admin/users">Пользователи</Link>
        </div>
      </div>
      {err ? <p style={{ color: 'var(--danger, #f87171)' }}>{err}</p> : null}
      {!metrics ? <p>Загрузка…</p> : null}

      {metrics ? (
        <>
          <h2 style={{ fontSize: '1rem', margin: '16px 0 8px', opacity: 0.9 }}>Пользователи</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
            <Metric label="Всего" value={formatNum(metrics.users.total)} />
            <Metric label="Новых за 7 дней" value={formatNum(metrics.users.new_7d)} hint={`за 30: ${metrics.users.new_30d}`} />
            <Metric label="Активных сегодня" value={formatNum(metrics.users.active_1d)} hint={`за 7д: ${metrics.users.active_7d}`} />
            <Metric label="Со своим ключом" value={formatNum(metrics.users.with_own_key)} />
            <Metric label="Админов" value={formatNum(metrics.users.admins)} />
            <Metric label="Заблокированы" value={formatNum(metrics.users.blocked)} />
            <Metric
              label="Выжгли trial"
              value={formatNum(metrics.users.trial_exhausted)}
              hint={`глобальный лимит ${formatNum(metrics.usage.trial_tokens_limit_global)}`}
            />
          </div>

          <h2 style={{ fontSize: '1rem', margin: '20px 0 8px', opacity: 0.9 }}>Использование</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
            <Metric label="Токены (всего)" value={formatNum(metrics.usage.tokens_total)} />
            <Metric label="Стоимость (host-key оценка)" value={formatDollars(metrics.usage.dollars_total)} />
            <Metric
              label="Trial max completion"
              value={`$${metrics.usage.trial_max_completion_per_m}/1M`}
            />
            <Metric label="События за сутки" value={formatNum(metrics.events.last_1d)} hint={`за 7д: ${metrics.events.last_7d}`} />
          </div>

          <h2 style={{ fontSize: '1rem', margin: '20px 0 8px', opacity: 0.9 }}>События за 7 дней (top 20)</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 6 }}>
            {metrics.events.by_name_7d.length === 0 ? (
              <p style={{ opacity: 0.7, fontSize: 13 }}>Событий нет.</p>
            ) : (
              metrics.events.by_name_7d.map((e) => (
                <div
                  key={e.event}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 8,
                    padding: '6px 10px',
                    fontSize: 13,
                  }}
                >
                  <span style={{ opacity: 0.85 }}>{e.event}</span>
                  <strong>{formatNum(e.count)}</strong>
                </div>
              ))
            )}
          </div>

          <h2 style={{ fontSize: '1rem', margin: '20px 0 8px', opacity: 0.9 }}>Top users по токенам</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.12)', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>#</th>
                <th style={{ padding: '6px 8px' }}>Логин</th>
                <th style={{ padding: '6px 8px' }}>Токены</th>
                <th style={{ padding: '6px 8px' }}>$</th>
                <th style={{ padding: '6px 8px' }} />
              </tr>
            </thead>
            <tbody>
              {metrics.top_users_by_tokens.map((u) => (
                <tr key={u.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <td style={{ padding: '6px 8px' }}>{u.id}</td>
                  <td style={{ padding: '6px 8px' }}>{u.username}</td>
                  <td style={{ padding: '6px 8px' }}>{formatNum(u.tokens_used)}</td>
                  <td style={{ padding: '6px 8px' }}>{formatDollars(u.dollars_used)}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <Link to={`/admin/users/${u.id}`}>Открыть</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <h2 style={{ fontSize: '1rem', margin: '24px 0 8px', opacity: 0.9, display: 'flex', gap: 12, alignItems: 'center' }}>
        <span>Здоровье моделей каталога</span>
        <button type="button" onClick={runHealthNow} disabled={busy} style={{ fontSize: 12 }}>
          {busy ? 'Проверяем…' : 'Проверить сейчас'}
        </button>
        {health?.last_checked_at ? (
          <span style={{ fontSize: 11, opacity: 0.6 }}>Обновлено: {health.last_checked_at}</span>
        ) : null}
      </h2>
      {health ? (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, marginBottom: 16 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.12)', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>Режим / Тир</th>
                <th style={{ padding: '6px 8px' }}>Модель</th>
                <th style={{ padding: '6px 8px' }}>Статус</th>
                <th style={{ padding: '6px 8px' }}>Выход $/1M</th>
                <th style={{ padding: '6px 8px' }}>Причина / Замена</th>
              </tr>
            </thead>
            <tbody>
              {health.items.map((it) => {
                const comp = it.last_pricing_completion
                  ? (it.last_pricing_completion * 1_000_000).toFixed(2)
                  : '—'
                return (
                  <tr key={it.model_id + it.mode + it.tier} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <td style={{ padding: '6px 8px' }}>
                      {it.mode}/{it.tier}
                    </td>
                    <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace' }}>{it.model_id}</td>
                    <td style={{ padding: '6px 8px' }}>
                      {it.available ? (
                        <span style={{ color: '#3fb950' }}>ок</span>
                      ) : (
                        <span style={{ color: '#f85149' }}>недоступна</span>
                      )}
                    </td>
                    <td style={{ padding: '6px 8px' }}>${comp}</td>
                    <td style={{ padding: '6px 8px' }}>
                      {it.reason}
                      {it.swapped_to ? ` · замена → ${it.swapped_to}` : ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <h2 style={{ fontSize: '1rem', margin: '12px 0 6px', opacity: 0.9 }}>События health-check (50)</h2>
          <ul style={{ listStyle: 'none', padding: 0, fontSize: 12 }}>
            {health.events.length === 0 ? (
              <li style={{ opacity: 0.7 }}>Событий нет.</li>
            ) : (
              health.events.map((e) => (
                <li
                  key={e.id}
                  style={{ padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                >
                  <span style={{ opacity: 0.6 }}>{e.created_at} · </span>
                  <strong>{e.model_id}</strong> · {e.event} · {e.detail}
                </li>
              ))
            )}
          </ul>
        </>
      ) : null}
    </div>
  )
}
