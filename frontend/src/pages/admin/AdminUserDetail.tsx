import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { api, type AdminUserEvent } from '../../api/client'
import { useAuth } from '../../context/AuthContext'

type AdminUserDetailPayload = {
  user: Record<string, unknown>
  usage: Record<string, unknown>
  trial: Record<string, unknown>
}

function numToInput(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return ''
}

export default function AdminUserDetail() {
  const { userId } = useParams()
  const { user } = useAuth()
  const id = Number(userId)
  const [detail, setDetail] = useState<AdminUserDetailPayload | null>(null)
  const [events, setEvents] = useState<AdminUserEvent[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [limTrial, setLimTrial] = useState('')
  const [limRpm, setLimRpm] = useState('')
  const [limSess, setLimSess] = useState('')
  const [clearTrial, setClearTrial] = useState(false)
  const [clearRpm, setClearRpm] = useState(false)
  const [clearSess, setClearSess] = useState(false)
  const [savingLimits, setSavingLimits] = useState(false)

  useEffect(() => {
    if (!user?.is_admin || !Number.isFinite(id) || id <= 0) return
    let cancelled = false
    Promise.all([api.adminGetUser(id), api.adminUserEvents(id, 80)])
      .then(([d, ev]) => {
        if (!cancelled) {
          setDetail(d as AdminUserDetailPayload)
          const u = d.usage as Record<string, unknown>
          setLimTrial(numToInput(u.trial_tokens_limit))
          setLimRpm(numToInput(u.rate_limit_rpm))
          setLimSess(numToInput(u.session_generation_budget))
          setClearTrial(false)
          setClearRpm(false)
          setClearSess(false)
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
  if (!Number.isFinite(id) || id <= 0) return <Navigate to="/admin/users" replace />

  const reload = () => {
    setErr(null)
    Promise.all([api.adminGetUser(id), api.adminUserEvents(id, 80)])
      .then(([d, ev]) => {
        setDetail(d as AdminUserDetailPayload)
        const u = d.usage as Record<string, unknown>
        setLimTrial(numToInput(u.trial_tokens_limit))
        setLimRpm(numToInput(u.rate_limit_rpm))
        setLimSess(numToInput(u.session_generation_budget))
        setClearTrial(false)
        setClearRpm(false)
        setClearSess(false)
        setEvents(ev.events)
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Ошибка'))
  }

  const saveLimits = () => {
    const body: {
      trial_tokens_limit?: number | null
      rate_limit_rpm?: number | null
      session_generation_budget?: number | null
    } = {}
    if (clearTrial) body.trial_tokens_limit = null
    else if (limTrial.trim()) {
      const n = parseInt(limTrial.trim(), 10)
      if (!Number.isFinite(n) || n < 0) {
        setErr('Лимит токенов: введите неотрицательное целое или оставьте пустым')
        return
      }
      body.trial_tokens_limit = n
    }
    if (clearRpm) body.rate_limit_rpm = null
    else if (limRpm.trim()) {
      const n = parseInt(limRpm.trim(), 10)
      if (!Number.isFinite(n) || n < 0) {
        setErr('RPM: введите неотрицательное целое или оставьте пустым')
        return
      }
      body.rate_limit_rpm = n
    }
    if (clearSess) body.session_generation_budget = null
    else if (limSess.trim()) {
      const n = parseInt(limSess.trim(), 10)
      if (!Number.isFinite(n) || n < 0) {
        setErr('Бюджет сессии: введите неотрицательное целое или оставьте пустым')
        return
      }
      body.session_generation_budget = n
    }
    if (Object.keys(body).length === 0) {
      setErr('Выберите поля: новое значение или «сброс»')
      return
    }
    setSavingLimits(true)
    setErr(null)
    api
      .adminPatchUserLimits(id, body)
      .then(() => reload())
      .catch((e) => setErr(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setSavingLimits(false))
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <p>
        <Link to="/admin/users">← К списку</Link>
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
            <h2 style={{ fontSize: '1.1rem', marginBottom: 8 }}>Использование и лимиты</h2>
            <dl
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: '6px 16px',
                fontSize: 14,
                marginBottom: 16,
              }}
            >
              <dt style={{ opacity: 0.75 }}>Токены (trial-счётчик)</dt>
              <dd style={{ margin: 0 }}>{String(detail.usage.tokens_used ?? 0)}</dd>
              <dt style={{ opacity: 0.75 }}>Оценка $ (host key)</dt>
              <dd style={{ margin: 0 }}>{Number(detail.usage.dollars_used ?? 0).toFixed(6)}</dd>
              <dt style={{ opacity: 0.75 }}>Лимит токенов (эффективный)</dt>
              <dd style={{ margin: 0 }}>{String(detail.trial.tokens_limit_effective ?? '—')}</dd>
              <dt style={{ opacity: 0.75 }}>Глобальный лимит</dt>
              <dd style={{ margin: 0 }}>{String(detail.trial.tokens_limit_global ?? '—')}</dd>
              <dt style={{ opacity: 0.75 }}>Остаток trial</dt>
              <dd style={{ margin: 0 }}>
                {detail.trial.tokens_remaining != null ? String(detail.trial.tokens_remaining) : '— (свой ключ)'}
              </dd>
              <dt style={{ opacity: 0.75 }}>Генераций на сессию (эффект.)</dt>
              <dd style={{ margin: 0 }}>{String(detail.trial.session_generation_budget_effective ?? '—')}</dd>
            </dl>
            <h3 style={{ fontSize: '1rem', marginBottom: 8 }}>Переопределения (БД)</h3>
            <p style={{ fontSize: 13, opacity: 0.85, marginBottom: 12 }}>
              Пустое поле при сохранении значит «не менять». Галочка «сброс» отправляет null и возвращает глобальное
              значение.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 480 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span>Лимит токенов (пробный), целое</span>
                <input
                  value={limTrial}
                  onChange={(e) => {
                    setLimTrial(e.target.value)
                    setClearTrial(false)
                  }}
                  disabled={clearTrial}
                  placeholder="пусто = не менять"
                  style={{ padding: '8px 10px', borderRadius: 8 }}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={clearTrial} onChange={(e) => setClearTrial(e.target.checked)} />
                  Сбросить оверрайд (null)
                </label>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span>Запросов в минуту (RPM)</span>
                <input
                  value={limRpm}
                  onChange={(e) => {
                    setLimRpm(e.target.value)
                    setClearRpm(false)
                  }}
                  disabled={clearRpm}
                  placeholder="пусто = не менять"
                  style={{ padding: '8px 10px', borderRadius: 8 }}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={clearRpm} onChange={(e) => setClearRpm(e.target.checked)} />
                  Сбросить оверрайд (null)
                </label>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                <span>Бюджет генераций на auth-сессию</span>
                <input
                  value={limSess}
                  onChange={(e) => {
                    setLimSess(e.target.value)
                    setClearSess(false)
                  }}
                  disabled={clearSess}
                  placeholder="пусто = не менять"
                  style={{ padding: '8px 10px', borderRadius: 8 }}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={clearSess} onChange={(e) => setClearSess(e.target.checked)} />
                  Сбросить оверрайд (null)
                </label>
              </label>
              <button type="button" disabled={savingLimits} onClick={() => void saveLimits()}>
                {savingLimits ? 'Сохранение…' : 'Сохранить лимиты'}
              </button>
            </div>
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
