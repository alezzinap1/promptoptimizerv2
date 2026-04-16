import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import { useT } from '../i18n'
import styles from './Welcome.module.css'

/*
 * Landing page — marketing register, second iteration + i18n.
 *
 * All user-facing copy is now routed through useT() / i18n dictionaries
 * (see frontend/src/i18n/ru.ts, en.ts). The visual structure from the
 * first rewrite is kept: single-screen hero + live composer, rotating
 * typewriter headline, hand-drawn SVG annotations, scrolling ticker,
 * compact how/for-who/trust/faq sections.
 *
 * The ticker item list is built from the dict. We keep the status map
 * next to the data (instead of in the dict itself) because ok/degraded
 * statuses are not translated.
 */

function SparklesIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    </svg>
  )
}

function PlusIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

/*
 * Hand-drawn SVG helpers. Stroke width small (1.4px), stroke-linecap=round.
 * Reads as pen-on-paper, not a vector-precise designer circle.
 */

function AnnotCircle() {
  return (
    <svg
      className={styles.annotCircle}
      viewBox="0 0 200 60"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path
        d="M 12 30 C 12 10, 40 4, 100 4 C 160 4, 192 14, 188 32 C 184 50, 152 56, 100 56 C 48 56, 14 50, 12 30 Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ComposerBrackets() {
  return (
    <svg
      className={styles.composerBrackets}
      viewBox="0 0 200 200"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d="M 4 22 L 4 4 L 22 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M 178 4 L 196 4 L 196 22" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M 4 178 L 4 196 L 22 196" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M 178 196 L 196 196 L 196 178" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function ComposerArrow({ label }: { label: string }) {
  return (
    <svg className={styles.composerArrow} viewBox="0 0 60 90" fill="none" aria-hidden>
      <path
        d="M 4 10 C 14 30, 34 42, 50 70"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M 48 62 L 52 72 L 40 70"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <text
        x="8"
        y="8"
        fill="currentColor"
        fontFamily="var(--font-mono, monospace)"
        fontSize="9"
        fontStyle="italic"
        opacity="0.85"
      >
        {label}
      </text>
    </svg>
  )
}

/*
 * Typewriter rotator: cycles through `words`. Types a word character-by-
 * character, holds, deletes, moves on. Respects prefers-reduced-motion.
 */
function TypewriterRotator({ words }: { words: readonly string[] }) {
  const [wordIdx, setWordIdx] = useState(0)
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<'typing' | 'holding' | 'deleting'>('typing')

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  // When the word list itself changes (language switch), reset state so we
  // don't get stuck halfway through typing a no-longer-present word.
  useEffect(() => {
    setWordIdx(0)
    setText('')
    setPhase('typing')
  }, [words])

  useEffect(() => {
    if (reducedMotion) {
      setText(words[0] ?? '')
      return
    }
    const current = words[wordIdx] ?? ''
    let timeout: number

    if (phase === 'typing') {
      if (text.length < current.length) {
        timeout = window.setTimeout(() => {
          setText(current.slice(0, text.length + 1))
        }, 75)
      } else {
        timeout = window.setTimeout(() => setPhase('holding'), 1600)
      }
    } else if (phase === 'holding') {
      timeout = window.setTimeout(() => setPhase('deleting'), 1600)
    } else {
      if (text.length > 0) {
        timeout = window.setTimeout(() => {
          setText(current.slice(0, text.length - 1))
        }, 40)
      } else {
        timeout = window.setTimeout(() => {
          setWordIdx((i) => (i + 1) % words.length)
          setPhase('typing')
        }, 240)
      }
    }
    return () => window.clearTimeout(timeout)
  }, [phase, text, wordIdx, words, reducedMotion])

  return (
    <span className={styles.rotatingSlot}>
      <AnnotCircle />
      <span className={styles.rotatingWord}>{text || '\u00A0'}</span>
      {!reducedMotion ? <span className={styles.rotatingCaret} aria-hidden /> : null}
    </span>
  )
}

/* Mock status map for the ticker until Phase 9 wires /api/public/model-health-snapshot. */
type TickerStatus = 'ok' | 'degraded' | undefined

export default function Welcome() {
  const { user } = useAuth()
  const { t } = useT()
  const navigate = useNavigate()
  const composerRef = useRef<HTMLTextAreaElement | null>(null)

  const [task, setTask] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [err, setErr] = useState<string | null>(null)

  if (user) return <Navigate to="/home" replace />

  const runDemo = async () => {
    const trimmed = task.trim()
    if (trimmed.length < 3) {
      setErr(t.landing.composer.errorShort)
      return
    }
    setBusy(true)
    setErr(null)
    setResult('')
    try {
      const r = await api.demoGenerate(trimmed)
      setResult(r.prompt_block)
    } catch (e) {
      setErr(e instanceof Error ? e.message : t.landing.composer.errorNetwork)
    } finally {
      setBusy(false)
    }
  }

  const copyResult = () => {
    if (!result) return
    void navigator.clipboard.writeText(result).catch(() => {})
  }

  const openInStudio = () => {
    if (result) {
      try {
        localStorage.setItem(
          'metaprompt-seed-from-demo',
          JSON.stringify({ task, prompt_block: result, at: Date.now() }),
        )
      } catch {
        /* non-fatal */
      }
    }
    navigate('/login')
  }

  // TODO(phase-9): replace hardcoded items with the health snapshot endpoint.
  const tickerItems: ReadonlyArray<{ label: string; value: string; status?: TickerStatus }> = [
    { label: t.landing.ticker.stack, value: t.landing.ticker.stackValue },
    { label: t.landing.ticker.tierFast, value: 'deepseek-v2', status: 'ok' },
    { label: t.landing.ticker.tierMid, value: 'grok-2 · claude-haiku', status: 'ok' },
    { label: t.landing.ticker.tierAdvanced, value: 'claude-sonnet · gpt-4o', status: 'ok' },
    { label: t.landing.ticker.uptime, value: t.landing.ticker.uptimeValue, status: 'ok' },
    { label: t.landing.ticker.maxOut, value: t.landing.ticker.maxOutValue },
    { label: t.landing.ticker.health, value: t.landing.ticker.healthValue, status: 'ok' },
    { label: t.landing.ticker.vision, value: t.landing.ticker.visionValue, status: 'degraded' },
  ]

  const trustCells: ReadonlyArray<{
    label: string
    mode: string
    status: 'ok' | 'degraded' | 'down'
  }> = [
    { label: t.landing.trust.tiers.auto, mode: t.landing.trust.modes.text, status: 'ok' },
    { label: t.landing.trust.tiers.fast, mode: t.landing.trust.modes.text, status: 'ok' },
    { label: t.landing.trust.tiers.mid, mode: t.landing.trust.modes.text, status: 'ok' },
    { label: t.landing.trust.tiers.advanced, mode: t.landing.trust.modes.text, status: 'ok' },
    { label: t.landing.trust.tiers.auto, mode: t.landing.trust.modes.vision, status: 'degraded' },
    { label: t.landing.trust.tiers.advanced, mode: t.landing.trust.modes.vision, status: 'ok' },
  ]

  return (
    <div className={styles.landing}>
      {/* ============ HERO + LIVE COMPOSER ============ */}
      <section className={styles.hero}>
        <div className={styles.container}>
          <div className={styles.heroGrid}>
            <div className={`${styles.heroLeft} reveal-on-mount`}>
              <span className={`eyebrow ${styles.heroEyebrow}`}>{t.landing.hero.eyebrow}</span>
              <h1 className={styles.heroTitle}>
                {t.landing.hero.titleHead}
                <TypewriterRotator words={t.landing.hero.rotatingWords} />
                {t.landing.hero.titleTail}
              </h1>
              <p className={styles.heroSubtitle}>{t.landing.hero.subtitle}</p>
              <div className={styles.heroActions}>
                <Link to="/login" className={styles.btnPrimary}>
                  <SparklesIcon />
                  {t.landing.hero.ctaPrimary}
                </Link>
                <a href="#how" className={styles.btnGhost}>
                  {t.landing.hero.ctaGhost}
                </a>
              </div>
              <p className={styles.heroFootnote}>{t.landing.hero.footnote}</p>
            </div>

            <div className={`${styles.composerWrap} reveal-on-mount`}>
              <ComposerArrow label={t.landing.composer.arrowLabel} />
              <div className={styles.composerCard}>
                <ComposerBrackets />
                <div className={styles.composerHead}>
                  <span className={styles.composerTitle}>
                    <span className={styles.composerTitleDot} />
                    {t.landing.composer.title}
                  </span>
                  <span className={styles.composerTag}>{t.landing.composer.tag}</span>
                </div>
                <textarea
                  ref={composerRef}
                  className={styles.composerTextarea}
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  placeholder={t.landing.composer.placeholder}
                  rows={3}
                  aria-label={t.landing.composer.taskAria}
                />
                <div className={styles.composerFoot}>
                  <span className={styles.composerRate}>{t.landing.composer.rate}</span>
                  <button
                    type="button"
                    className={styles.composerRunBtn}
                    onClick={() => void runDemo()}
                    disabled={busy}
                  >
                    {busy ? `${t.landing.composer.submitting}…` : t.landing.composer.submit}
                  </button>
                </div>
                {err ? <p className={styles.composerError}>{err}</p> : null}
                {busy && !result ? (
                  <div className={styles.composerResult} aria-hidden>
                    <div className={styles.composerSkeleton} />
                    <div className={styles.composerSkeleton} />
                    <div className={styles.composerSkeleton} />
                    <div className={styles.composerSkeleton} />
                  </div>
                ) : null}
                {result ? (
                  <>
                    <pre className={styles.composerResult}>{result}</pre>
                    <div className={styles.composerActions}>
                      <button type="button" className={styles.composerActionBtn} onClick={copyResult}>
                        {t.landing.composer.actions.copy}
                      </button>
                      <button type="button" className={styles.composerActionBtn} onClick={openInStudio}>
                        {t.landing.composer.actions.openStudio}
                      </button>
                      <button type="button" className={styles.composerActionBtn} onClick={() => void runDemo()}>
                        {t.landing.composer.actions.regen}
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ TICKER ============ */}
      <div className={styles.ticker} aria-hidden>
        <div className={styles.tickerTrack}>
          {[...tickerItems, ...tickerItems].map((item, i) => (
            <span className={styles.tickerItem} key={`${item.label}-${i}`}>
              <span className={styles.tickerLabel}>{item.label}</span>
              <span className={styles.tickerValue}>{item.value}</span>
              {item.status ? (
                <span className={`${styles.tickerDot} ${styles[item.status]}`} />
              ) : null}
            </span>
          ))}
        </div>
      </div>

      {/* ============ HOW ============ */}
      <section className={styles.section} id="how">
        <div className={styles.container}>
          <header className={styles.sectionHead}>
            <span className={styles.sectionNum}>{t.landing.how.num}</span>
            <div>
              <h2 className={styles.sectionTitle}>{t.landing.how.title}</h2>
              <p className={styles.sectionLede}>{t.landing.how.lede}</p>
            </div>
          </header>
          <div className={styles.howGrid}>
            {t.landing.how.cards.map((c) => (
              <article key={c.num} className={styles.howCard}>
                <div className={styles.howCardHead}>
                  <span className={styles.howCardNum}>{c.num}</span>
                  <span className={styles.howCardGlyph}>
                    <SparklesIcon size={14} />
                  </span>
                </div>
                <h3 className={styles.howCardTitle}>{c.title}</h3>
                <p className={styles.howCardBody}>{c.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ============ FOR WHO ============ */}
      <section className={styles.forWho}>
        <div className={styles.container}>
          <header className={styles.sectionHead}>
            <span className={styles.sectionNum}>{t.landing.forWho.num}</span>
            <div>
              <h2 className={styles.sectionTitle}>{t.landing.forWho.title}</h2>
            </div>
          </header>
          <div className={styles.forWhoGrid}>
            <article className={styles.forWhoCol}>
              <div className={styles.forWhoHead}>
                <span className={`${styles.forWhoBadge} ${styles.beginner}`}>
                  {t.landing.forWho.beginner.badge}
                </span>
                <h3 className={styles.forWhoTitle}>{t.landing.forWho.beginner.title}</h3>
              </div>
              <ul className={styles.forWhoList}>
                {t.landing.forWho.beginner.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </article>
            <article className={styles.forWhoCol}>
              <div className={styles.forWhoHead}>
                <span className={`${styles.forWhoBadge} ${styles.engineer}`}>
                  {t.landing.forWho.engineer.badge}
                </span>
                <h3 className={styles.forWhoTitle}>{t.landing.forWho.engineer.title}</h3>
              </div>
              <ul className={styles.forWhoList}>
                {t.landing.forWho.engineer.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </article>
          </div>
        </div>
      </section>

      {/* ============ TRUST ============ */}
      {/* TODO(phase-9): swap mock cells for GET /api/public/model-health-snapshot. */}
      <section className={styles.section}>
        <div className={styles.container}>
          <header className={styles.sectionHead}>
            <span className={styles.sectionNum}>{t.landing.trust.num}</span>
            <div>
              <h2 className={styles.sectionTitle}>{t.landing.trust.title}</h2>
              <p className={styles.sectionLede}>{t.landing.trust.lede}</p>
            </div>
          </header>
          <div className={styles.trustBar}>
            {trustCells.map((c, i) => (
              <div key={`${c.label}-${c.mode}-${i}`} className={styles.trustCell}>
                <div className={styles.trustInfo}>
                  <span className={styles.trustLabel}>{c.label}</span>
                  <span className={styles.trustMode}>{c.mode}</span>
                </div>
                <span className={`${styles.trustDot} ${styles[c.status]}`} />
              </div>
            ))}
          </div>
          <p className={styles.trustFootnote}>{t.landing.trust.footnote}</p>
        </div>
      </section>

      {/* ============ FAQ ============ */}
      <section className={styles.section}>
        <div className={styles.container}>
          <header className={styles.sectionHead}>
            <span className={styles.sectionNum}>{t.landing.faq.num}</span>
            <div>
              <h2 className={styles.sectionTitle}>{t.landing.faq.title}</h2>
            </div>
          </header>
          <div className={styles.faqList}>
            {t.landing.faq.rows.map((row) => (
              <details key={row.q} className={styles.faqItem}>
                <summary className={styles.faqSummary}>
                  <span>{row.q}</span>
                  <span className={styles.faqChevron} aria-hidden>
                    <PlusIcon />
                  </span>
                </summary>
                <div className={styles.faqBody}>{row.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer>
        <div className={styles.container}>
          <div className={styles.footerBar}>
            <span>{t.landing.footer.brand}</span>
            <div className={styles.footerLinks}>
              <Link to="/login">{t.landing.footer.loginLink}</Link>
              <a href="https://github.com" target="_blank" rel="noreferrer noopener">
                {t.landing.footer.githubLink}
              </a>
              <a href="#how">{t.landing.footer.howLink}</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
