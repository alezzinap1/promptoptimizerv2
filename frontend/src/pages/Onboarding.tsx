import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useT } from '../i18n'
import { pushRecentSession } from '../lib/recentSessions'
import { useSimulatedLlmStream } from '../lib/simulatedLlmStream'
import ThemedTooltip from '../components/ThemedTooltip'
import styles from './Onboarding.module.css'

/*
 * Three-step onboarding.
 *   1. Goal: work / study / own (used to seed step-3 suggestions and
 *      stored on the account so empty-state starters in the Library
 *      work across devices).
 *   2. Default tier: auto / fast / mid / advanced. Saved to
 *      preferences.default_tier so Studio / Simple Improve can pick it
 *      up as the user's personal default.
 *   3. First task: real generation through /api/generate with the
 *      chosen tier. Result is pushed to recentSessions so /home picks
 *      it up in the sidebar immediately.
 *
 * Persistence (Phase 9):
 *   - Mount: /api/settings returns `user_goal` and `default_tier`. If
 *     non-empty, they seed local state (beats localStorage).
 *   - persistGoal / persistTier write to localStorage (for offline /
 *     anonymous flow) and fire-and-forget PATCH /api/settings.
 *
 * Runs inside the marketing register (body.register-marketing — see
 * App.tsx MARKETING_PATHS), so cream palette + serif-italic accent
 * match the landing. Progressive disclosure: user can always Skip.
 */

const LS_GOAL = 'metaprompt-onboarding-goal'
const LS_TIER = 'metaprompt-default-tier'

type GoalId = 'work' | 'study' | 'own'
type TierId = 'auto' | 'fast' | 'mid' | 'advanced'

function loadGoal(): GoalId | null {
  try {
    const v = localStorage.getItem(LS_GOAL)
    if (v === 'work' || v === 'study' || v === 'own') return v
  } catch { /* non-fatal */ }
  return null
}

function loadTier(): TierId {
  try {
    const v = localStorage.getItem(LS_TIER)
    if (v === 'auto' || v === 'fast' || v === 'mid' || v === 'advanced') return v
  } catch { /* non-fatal */ }
  return 'auto'
}

function ArrowRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  )
}

export default function Onboarding() {
  const navigate = useNavigate()
  const { t } = useT()
  const totalSteps = 3

  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [goal, setGoal] = useState<GoalId | null>(() => loadGoal())
  const [tier, setTier] = useState<TierId>(() => loadTier())

  // On mount, let server-side preferences beat localStorage — they are
  // the cross-device source of truth once set.
  useEffect(() => {
    let cancelled = false
    api
      .getSettings()
      .then((s) => {
        if (cancelled) return
        const serverGoal = (s.user_goal || '').trim()
        if (serverGoal === 'work' || serverGoal === 'study' || serverGoal === 'own') {
          setGoal(serverGoal)
        }
        const serverTier = (s.default_tier || '').trim()
        if (serverTier === 'auto' || serverTier === 'fast' || serverTier === 'mid' || serverTier === 'advanced') {
          setTier(serverTier)
        }
      })
      .catch(() => { /* non-fatal: fall back to localStorage */ })
    return () => { cancelled = true }
  }, [])

  // Step 3 state
  const [task, setTask] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<string>('')
  const [sessionId, setSessionId] = useState<string>('')
  /** Мгновенно показать весь текст (клик по превью — как раньше skip). */
  const [streamSkipped, setStreamSkipped] = useState(false)
  const revealed = useSimulatedLlmStream(result, { suspend: busy || streamSkipped })
  const revealDone = !result || revealed.length >= result.length
  const revealSkip = () => setStreamSkipped(true)

  const progressPct = Math.min(100, (step / totalSteps) * 100)
  const progressLabel = t.onboarding.progress
    .replace('{current}', String(step))
    .replace('{total}', String(totalSteps))

  const suggestions = useMemo(() => {
    if (!goal) return t.onboarding.step3.suggestionsByGoal.work
    return t.onboarding.step3.suggestionsByGoal[goal] || []
  }, [goal, t])

  const persistGoal = (g: GoalId) => {
    setGoal(g)
    try { localStorage.setItem(LS_GOAL, g) } catch { /* non-fatal */ }
    api.updateSettings({ user_goal: g }).catch(() => { /* non-fatal: localStorage is still the fallback */ })
  }
  const persistTier = (tr: TierId) => {
    setTier(tr)
    try { localStorage.setItem(LS_TIER, tr) } catch { /* non-fatal */ }
    api.updateSettings({ default_tier: tr }).catch(() => { /* non-fatal: localStorage fallback */ })
  }

  const skip = () => navigate('/home', { replace: true })

  const goNext = () => {
    if (step < 3) setStep((s) => (s + 1) as 1 | 2 | 3)
  }
  const goBack = () => {
    if (step > 1) setStep((s) => (s - 1) as 1 | 2 | 3)
  }

  const generate = async () => {
    const trimmed = task.trim()
    if (trimmed.length < 5) {
      setErr(t.onboarding.step3.errorShort)
      return
    }
    setBusy(true)
    setErr(null)
    setResult('')
    setSessionId('')
    setStreamSkipped(false)
    try {
      const r = await api.generate({
        task_input: trimmed,
        tier,
        domain: 'text',
        technique_mode: 'auto',
      })
      setResult(r.prompt_block || r.llm_raw || '')
      if (r.session_id) {
        setSessionId(r.session_id)
        pushRecentSession(r.session_id, trimmed)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.onboarding.step3.errorNetwork)
    } finally {
      setBusy(false)
    }
  }

  const openInStudio = () => {
    // Home.tsx doesn't yet read ?session=; the new session still
    // appears in the sidebar via recentSessions. Phase 5 can wire a
    // ?session= deep-link if needed.
    void sessionId
    navigate('/home', { replace: true })
  }

  const retry = () => {
    setResult('')
    setErr(null)
    setSessionId('')
    setStreamSkipped(false)
  }

  return (
    <div className={styles.onboarding}>
      <div className={styles.progressBar}>
        <span className={styles.progressLabel}>{progressLabel}</span>
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
        </div>
        <button type="button" className={styles.progressSkip} onClick={skip}>
          {t.onboarding.skip}
        </button>
      </div>

      <div className={styles.body}>
        {step === 1 && (
          <>
            <span className={styles.eyebrow}>{t.onboarding.step1.eyebrow}</span>
            <h1 className={styles.title}>{t.onboarding.step1.title}</h1>
            <p className={styles.lede}>{t.onboarding.step1.lede}</p>
            <div className={`${styles.chips} ${styles.goals}`}>
              {t.onboarding.step1.goals.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={`${styles.chip} ${goal === g.id ? styles.chipActive : ''}`}
                  onClick={() => persistGoal(g.id as GoalId)}
                  aria-pressed={goal === g.id}
                >
                  <span className={styles.chipLabel}>{g.label}</span>
                  <span className={styles.chipHint}>{g.hint}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <span className={styles.eyebrow}>{t.onboarding.step2.eyebrow}</span>
            <h1 className={styles.title}>{t.onboarding.step2.title}</h1>
            <p className={styles.lede}>{t.onboarding.step2.lede}</p>
            <div className={`${styles.chips} ${styles.tiers}`}>
              {t.onboarding.step2.tiers.map((tr) => (
                <button
                  key={tr.id}
                  type="button"
                  className={`${styles.chip} ${tier === tr.id ? styles.chipActive : ''}`}
                  onClick={() => persistTier(tr.id as TierId)}
                  aria-pressed={tier === tr.id}
                >
                  <span className={styles.chipLabel}>{tr.label}</span>
                  <span className={styles.chipHint}>{tr.body}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <span className={styles.eyebrow}>{t.onboarding.step3.eyebrow}</span>
            <h1 className={styles.title}>{t.onboarding.step3.title}</h1>
            <p className={styles.lede}>{t.onboarding.step3.lede}</p>

            <div className={styles.formBlock}>
              <textarea
                className={styles.textarea}
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder={t.onboarding.step3.placeholder}
                rows={4}
                disabled={busy || !!result}
              />

              {!result ? (
                <div className={styles.suggestions}>
                  <span className={styles.suggestionsTitle}>
                    {t.onboarding.step3.suggestionsTitle}
                  </span>
                  <div className={styles.suggestionsList}>
                    {suggestions.map((s) => (
                      <ThemedTooltip key={s} content={s} side="top" delayMs={220}>
                        <button
                          type="button"
                          className={styles.suggestionPill}
                          onClick={() => setTask(s)}
                          disabled={busy}
                        >
                          {s}
                        </button>
                      </ThemedTooltip>
                    ))}
                  </div>
                </div>
              ) : null}

              {err ? <p className={styles.errorMsg}>{err}</p> : null}

              {busy && !result ? (
                <div className={styles.resultBlock} aria-hidden>
                  <div className={styles.skeletonRow} />
                  <div className={styles.skeletonRow} />
                  <div className={styles.skeletonRow} />
                  <div className={styles.skeletonRow} />
                </div>
              ) : null}

              {result ? (
                <div className={styles.resultBlock}>
                  <h3 className={styles.resultTitle}>{t.onboarding.step3.resultTitle}</h3>
                  <ThemedTooltip
                    content="click to reveal full prompt"
                    side="bottom"
                    delayMs={280}
                    disabled={revealDone}
                    block
                  >
                    <pre
                      className={styles.resultPre}
                      onClick={revealDone ? undefined : revealSkip}
                    >
                      {revealed}
                      {!revealDone ? <span className={styles.revealCaret} aria-hidden /> : null}
                    </pre>
                  </ThemedTooltip>
                  <div className={styles.resultActions}>
                    <button type="button" className={styles.btnPrimary} onClick={openInStudio}>
                      {t.onboarding.step3.actions.openStudio}
                    </button>
                    <button type="button" className={styles.btnGhost} onClick={retry}>
                      {t.onboarding.step3.actions.again}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>

      <footer className={styles.footer}>
        <div className={styles.footerLeft}>
          {step > 1 ? (
            <button type="button" className={styles.btnGhost} onClick={goBack}>
              {t.onboarding.back}
            </button>
          ) : (
            <span />
          )}
        </div>
        <div className={styles.footerLeft}>
          {step < 3 ? (
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={goNext}
              disabled={step === 1 && !goal}
            >
              {t.onboarding.next}
              <ArrowRightIcon />
            </button>
          ) : !result ? (
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => void generate()}
              disabled={busy || task.trim().length < 5}
            >
              {busy ? `${t.onboarding.step3.submitting}…` : t.onboarding.step3.submit}
              {!busy ? <ArrowRightIcon /> : null}
            </button>
          ) : (
            <button type="button" className={styles.btnPrimary} onClick={openInStudio}>
              {t.onboarding.done.cta}
              <ArrowRightIcon />
            </button>
          )}
        </div>
      </footer>
    </div>
  )
}
