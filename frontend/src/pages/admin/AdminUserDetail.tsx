import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { api, type AdminUserEvent } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import ThemedTooltip from '../../components/ThemedTooltip'

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

function fmt(v: unknown): string {
  if (v == null || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'да' : 'нет'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(6)
  return String(v)
}

function fmtDate(v: unknown): string {
  if (!v) return '—'
  try {
    const d = new Date(String(v))
    if (!Number.isFinite(d.getTime())) return String(v)
    return d.toLocaleString()
  } catch {
    return String(v)
  }
}

const EVENT_LABELS: Record<string, string> = {
  generate_requested: 'Запуск генерации',
  generate_prompt_success: 'Промпт сгенерирован',
  generate_questions: 'Получены уточнения',
  generate_raw_text: 'Сырой ответ',
  generation_result: 'Итог генерации',
  login: 'Вход',
  logout: 'Выход',
  signup: 'Регистрация',
  translate_requested: 'Перевод текста',
  skill_saved: 'Скилл сохранён',
  prompt_saved: 'Промпт сохранён',
}

const PAYLOAD_KEY_LABELS: Record<string, string> = {
  outcome: 'Исход',
  gen_model: 'Модель',
  target_model: 'Целевая модель',
  tier: 'Тир',
  tier_picked_model: 'Модель (по тиру)',
  latency_ms: 'Задержка, мс',
  technique_ids: 'Техники',
  completeness_score: 'Completeness',
  questions_contract_used: 'Контракт вопросов',
  scene_analysis_applied: 'Deep сцена',
  iteration_mode: 'Итерация',
  questions_mode: 'Вопросы',
  technique_mode: 'Режим техник',
  workspace_id: 'Workspace',
  task_classification_mode: 'Классификатор',
  question_count: 'Вопросов',
  debug_issue_count: 'Debug issues',
  direction: 'Направление',
  kind: 'Тип текста',
  detected: 'Исходный язык',
  chars_in: 'Символов (вход)',
  chars_out: 'Символов (выход)',
}

function eventSummary(e: AdminUserEvent): string {
  const label = EVENT_LABELS[e.event_name] || e.event_name
  const p = e.payload || {}
  const parts: string[] = [label]
  const outcome = typeof p['outcome'] === 'string' ? (p['outcome'] as string) : ''
  if (outcome) parts.push(`· ${outcome}`)
  const tier = typeof p['tier'] === 'string' ? (p['tier'] as string) : ''
  if (tier && tier !== 'custom') parts.push(`· тир «${tier}»`)
  const lat = typeof p['latency_ms'] === 'number' ? (p['latency_ms'] as number) : null
  if (lat != null) parts.push(`· ${Math.round(lat)} мс`)
  const cs = typeof p['completeness_score'] === 'number' ? (p['completeness_score'] as number) : null
  if (cs != null) parts.push(`· completeness ${cs.toFixed(2)}`)
  const qc = typeof p['question_count'] === 'number' ? (p['question_count'] as number) : null
  if (qc != null) parts.push(`· ${qc} вопр.`)
  return parts.join(' ')
}

function EventRow({ e, idx }: { e: AdminUserEvent; idx: number }) {
  const [open, setOpen] = useState(false)
  const p = e.payload || {}
  const keys = Object.keys(p)
  return (
    <li
      style={{
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        padding: '8px 4px',
        fontSize: 13,
        listStyle: 'none',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          width: '100%',
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          padding: 0,
          textAlign: 'left',
        }}
        aria-expanded={open}
        aria-label={`Событие #${idx + 1}: ${e.event_name}`}
      >
        <span>{eventSummary(e)}</span>
        <span style={{ opacity: 0.65, fontVariantNumeric: 'tabular-nums' }}>{fmtDate(e.created_at)}</span>
      </button>
      {open && keys.length > 0 ? (
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: '4px 12px',
            marginTop: 6,
            fontSize: 12,
            padding: '6px 8px',
            background: 'rgba(255,255,255,0.03)',
            borderRadius: 6,
          }}
        >
          {keys.map((k) => (
            <FieldRow key={k} keyName={k} value={p[k]} />
          ))}
        </dl>
      ) : null}
    </li>
  )
}

function FieldRow({ keyName, value }: { keyName: string; value: unknown }) {
  const label = PAYLOAD_KEY_LABELS[keyName] || keyName
  let rendered: string
  if (Array.isArray(value)) rendered = value.length ? value.join(', ') : '—'
  else if (value && typeof value === 'object') rendered = JSON.stringify(value)
  else rendered = fmt(value)
  return (
    <>
      <dt style={{ opacity: 0.7 }}>{label}</dt>
      <dd style={{ margin: 0, wordBreak: 'break-word' }}>{rendered}</dd>
    </>
  )
}

function ProfileCard({ user }: { user: Record<string, unknown> }) {
  const fields: { label: string; key: string; fmt?: 'date' | 'bool' | 'raw' }[] = [
    { label: 'ID', key: 'id' },
    { label: 'Email', key: 'email' },
    { label: 'Имя', key: 'name' },
    { label: 'Пользователь', key: 'username' },
    { label: 'Источник', key: 'provider' },
    { label: 'Роль', key: 'role' },
    { label: 'Администратор', key: 'is_admin', fmt: 'bool' },
    { label: 'Заблокирован', key: 'blocked', fmt: 'bool' },
    { label: 'Свой API ключ', key: 'has_own_openrouter_key', fmt: 'bool' },
    { label: 'Создан', key: 'created_at', fmt: 'date' },
    { label: 'Последний вход', key: 'last_login_at', fmt: 'date' },
  ]
  const shown = fields.filter((f) => user[f.key] != null)
  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: '6px 16px',
        fontSize: 14,
        margin: 0,
        padding: '12px 16px',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10,
        background: 'rgba(255,255,255,0.02)',
      }}
    >
      {shown.map((f) => {
        const v = user[f.key]
        let rendered: string
        if (f.fmt === 'date') rendered = fmtDate(v)
        else if (f.fmt === 'bool') rendered = v ? 'да' : 'нет'
        else rendered = fmt(v)
        return (
          <div key={f.key} style={{ display: 'contents' }}>
            <dt style={{ opacity: 0.75 }}>{f.label}</dt>
            <dd style={{ margin: 0 }}>{rendered}</dd>
          </div>
        )
      })}
    </dl>
  )
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

  const eventStats = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const e of events) counts[e.event_name] = (counts[e.event_name] || 0) + 1
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
  }, [events])

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
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: 24 }}>
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
            <h2 style={{ fontSize: '1.1rem', marginBottom: 10 }}>Профиль</h2>
            <ProfileCard user={detail.user} />
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
                padding: '12px 16px',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 10,
                background: 'rgba(255,255,255,0.02)',
              }}
            >
              <dt style={{ opacity: 0.75 }}>Токены (trial-счётчик)</dt>
              <dd style={{ margin: 0 }}>{fmt(detail.usage.tokens_used)}</dd>
              <dt style={{ opacity: 0.75 }}>Оценка $ (host key)</dt>
              <dd style={{ margin: 0 }}>{Number(detail.usage.dollars_used ?? 0).toFixed(6)}</dd>
              <dt style={{ opacity: 0.75 }}>Лимит токенов (эффективный)</dt>
              <dd style={{ margin: 0 }}>{fmt(detail.trial.tokens_limit_effective)}</dd>
              <dt style={{ opacity: 0.75 }}>Глобальный лимит</dt>
              <dd style={{ margin: 0 }}>{fmt(detail.trial.tokens_limit_global)}</dd>
              <dt style={{ opacity: 0.75 }}>Остаток trial</dt>
              <dd style={{ margin: 0 }}>
                {detail.trial.tokens_remaining != null ? fmt(detail.trial.tokens_remaining) : '— (свой ключ)'}
              </dd>
              <dt style={{ opacity: 0.75 }}>Генераций на сессию (эффект.)</dt>
              <dd style={{ margin: 0 }}>{fmt(detail.trial.session_generation_budget_effective)}</dd>
              <dt style={{ opacity: 0.75 }}>RPM (эффект.)</dt>
              <dd style={{ margin: 0 }}>{fmt(detail.trial.rate_limit_rpm_effective ?? detail.usage.rate_limit_rpm)}</dd>
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
            <h2 style={{ fontSize: '1.1rem', marginBottom: 8 }}>Активность</h2>
            {eventStats.length > 0 ? (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                {eventStats.map(([name, cnt]) => (
                  <ThemedTooltip key={name} content={name} side="top" delayMs={200}>
                    <span
                      style={{
                        padding: '3px 10px',
                        fontSize: 12,
                        borderRadius: 999,
                        border: '1px solid rgba(255,255,255,0.12)',
                        background: 'rgba(255,255,255,0.03)',
                      }}
                    >
                      {EVENT_LABELS[name] || name}: <b>{cnt}</b>
                    </span>
                  </ThemedTooltip>
                ))}
              </div>
            ) : null}
            <ul style={{ padding: 0, margin: 0 }}>
              {events.map((e, i) => (
                <EventRow key={`${e.event_name}-${i}`} e={e} idx={i} />
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  )
}
