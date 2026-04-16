import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import styles from './Welcome.module.css'

/*
 * Landing page — marketing register, second iteration.
 *
 * Changes from first version:
 *   - Collapsed hero + demo into ONE single-screen block.
 *     Live composer lives on the right; no separate demo section.
 *   - Rotating typewriter slot at the tail of the headline.
 *   - Hand-drawn SVG annotations (circle around rotating word,
 *     arrow from headline to composer, corner brackets on composer).
 *   - Narrow scrolling ticker band below the hero with stack info.
 *   - How / for-who / trust / faq pressed flat, single-row layouts.
 *
 * Copy is still hardcoded RU; Phase 3 will extract into i18n dicts.
 */

const COPY = {
  hero: {
    eyebrow: 'STUDIO · v0.9',
    titleHead: 'От общей задачи — к промпту, который ',
    titleTail: '.',
    rotatingWords: ['работает', 'понимает', 'держит', 'повторяется', 'проверяется'],
    subtitle:
      'Одно предложение на входе — структурированный промпт на выходе. Можно пощупать прямо здесь, без входа.',
    ctaPrimary: 'Открыть Studio →',
    ctaGhost: 'Что умеет',
    footnote: 'Без ключей. Без регистрации. Без обещаний.',
  },
  composer: {
    title: 'Живое демо',
    tag: 'DEMO',
    placeholder:
      'Напиши промпт для описания товара в интернет-магазине — лаконично, без рекламного тона.',
    rate: '5 / 5 мин',
    submit: 'Сгенерировать',
    submitting: 'Генерирую',
    error: 'Опишите задачу хотя бы одним предложением.',
    errorNetwork: 'Демо временно недоступно.',
    actions: {
      copy: 'Копировать',
      openStudio: 'Открыть в Studio',
      regen: 'Ещё вариант',
    },
  },
  ticker: [
    { label: 'stack', value: 'auto · mid · advanced' },
    { label: 'tier=fast', value: 'deepseek-v2', status: 'ok' as const },
    { label: 'tier=mid', value: 'grok-2 · claude-haiku', status: 'ok' as const },
    { label: 'tier=advanced', value: 'claude-sonnet · gpt-4o', status: 'ok' as const },
    { label: 'uptime', value: '30d · 99.2%', status: 'ok' as const },
    { label: 'max out', value: '≤ $3 / 1M tokens' },
    { label: 'health', value: '6/6 green', status: 'ok' as const },
    { label: 'vision', value: 'degraded · fallback ok', status: 'degraded' as const },
  ],
  how: {
    num: '01',
    title: 'Что это вообще',
    lede: 'Три вещи, которые продукт делает лучше, чем голый чат.',
    cards: [
      {
        num: '01',
        title: 'Compose',
        body: 'Задача на одной строке → собранный промпт с ролью, контекстом, ограничениями и форматом вывода. Руками править можно, а часто — не нужно.',
      },
      {
        num: '02',
        title: 'Compare',
        body: 'A/B две версии на одной задаче. Техники, модели или промпты целиком — как удобно. Судья разбирает по критериям, а не «мне больше нравится A».',
      },
      {
        num: '03',
        title: 'Keep',
        body: 'Библиотека с тегами, версиями, диффами и smart-группами. Рабочие промпты — рядом со студией, а не в закладках.',
      },
    ],
  },
  forWho: {
    num: '02',
    title: 'Для кого',
    beginner: {
      badge: 'Новичку',
      title: 'Если LLM есть, а системы нет',
      points: [
        'Не нужно знать слова «few-shot» и «chain-of-thought».',
        'Стартовые шаблоны и примеры в композере.',
        'Перевод RU ⇄ EN в один клик, без LLM.',
      ],
    },
    engineer: {
      badge: 'Инженеру',
      title: 'Если промпты — часть работы',
      points: [
        'Auto / Fast / Mid / Advanced вместо ручного выбора моделей.',
        'Запуск A/B на целевой модели, diff, разбор по критериям.',
        'Свой ключ OpenRouter снимает все лимиты хоста.',
      ],
    },
  },
  trust: {
    num: '03',
    title: 'Модели под капотом',
    lede: 'Проверяем ежедневно. Если что-то упало — подставляем эквивалент из той же ценовой корзины.',
    cells: [
      { label: 'Auto', mode: 'Text', status: 'ok' as const },
      { label: 'Fast', mode: 'Text', status: 'ok' as const },
      { label: 'Mid', mode: 'Text', status: 'ok' as const },
      { label: 'Advanced', mode: 'Text', status: 'ok' as const },
      { label: 'Auto', mode: 'Vision', status: 'degraded' as const },
      { label: 'Advanced', mode: 'Vision', status: 'ok' as const },
    ],
    footnote: 'Снимок последнего healthcheck · TTL 5 мин · подробнее в /admin/model-health',
  },
  faq: {
    num: '04',
    title: 'Часто спрашивают',
    rows: [
      {
        q: 'Зачем мне свой OpenRouter-ключ?',
        a: 'С ключом платишь напрямую провайдеру и выбираешь любые модели. Без ключа работает пробный режим с лимитами хоста — его хватает, чтобы распробовать.',
      },
      {
        q: 'Что за пробный режим и какие лимиты?',
        a: 'Набор токенов после регистрации плюс 10 генераций в 5 минут и дневной бюджет A/B-сравнений. Точные числа в профиле.',
      },
      {
        q: 'Что вы сохраняете?',
        a: 'Демо на этой странице — ничего. После входа: библиотека, история сессий, настройки. Текст задач в LLM мы провайдерам не пересылаем сверх того, что нужно для ответа.',
      },
      {
        q: 'Auto / Fast / Mid / Advanced — это что?',
        a: 'Уровни задач, не конкретные модели. Auto подбирает сам, Fast — быстро и дёшево, Mid — баланс, Advanced — сложные кейсы с рассуждениями. Модели под капотом могут меняться — мы следим, чтобы не ломалась воспроизводимость.',
      },
      {
        q: 'Можно без регистрации?',
        a: 'Демо-виджет наверху — да. Для Studio, библиотеки и A/B нужен аккаунт. Бесплатный.',
      },
      {
        q: 'Как считаете completeness?',
        a: 'Эвристикой по структуре текста: роли, ограничения, формат вывода, примеры. Это быстрый фильтр, не замена LLM-судьи.',
      },
    ],
  },
} as const

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
 * Hand-drawn SVG helpers. Strokes are deliberately wobbly and stroke-width small
 * (1–1.4px), with stroke-linecap=round. Reads as pen-on-paper, not designer-perfect.
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
        strokeDasharray="0"
        style={{ filter: 'url(#mpAnnotJitter)' }}
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
      {/* TL */}
      <path
        d="M 4 22 L 4 4 L 22 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      {/* TR */}
      <path
        d="M 178 4 L 196 4 L 196 22"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      {/* BL */}
      <path
        d="M 4 178 L 4 196 L 22 196"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      {/* BR */}
      <path
        d="M 178 196 L 196 196 L 196 178"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ComposerArrow() {
  return (
    <svg
      className={styles.composerArrow}
      viewBox="0 0 60 90"
      fill="none"
      aria-hidden
    >
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
        live · no login
      </text>
    </svg>
  )
}

/*
 * Typewriter rotator for the rotating word at the tail of the headline.
 * Cycles through a word list:
 *   - types a word character-by-character
 *   - holds it for `holdMs`
 *   - deletes it character-by-character
 *   - moves to the next word
 * Respects prefers-reduced-motion — renders the first word statically.
 */
function TypewriterRotator({ words }: { words: readonly string[] }) {
  const [wordIdx, setWordIdx] = useState(0)
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<'typing' | 'holding' | 'deleting'>('typing')

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    if (reducedMotion) {
      setText(words[0])
      return
    }
    const current = words[wordIdx]
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

export default function Welcome() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const composerRef = useRef<HTMLTextAreaElement | null>(null)

  const [task, setTask] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [err, setErr] = useState<string | null>(null)

  if (user) return <Navigate to="/home" replace />

  const runDemo = async () => {
    const t = task.trim()
    if (t.length < 3) {
      setErr(COPY.composer.error)
      return
    }
    setBusy(true)
    setErr(null)
    setResult('')
    try {
      const r = await api.demoGenerate(t)
      setResult(r.prompt_block)
    } catch (e) {
      setErr(e instanceof Error ? e.message : COPY.composer.errorNetwork)
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

  /* Ticker runs a horizontal marquee. We render the item list twice to make
   * the CSS translate(-50%) seamless. */
  const tickerItems = COPY.ticker

  return (
    <div className={styles.landing}>
      {/* ============ HERO + LIVE COMPOSER (single screen) ============ */}
      <section className={styles.hero}>
        <div className={styles.container}>
          <div className={styles.heroGrid}>
            <div className={`${styles.heroLeft} reveal-on-mount`}>
              <span className={`eyebrow ${styles.heroEyebrow}`}>{COPY.hero.eyebrow}</span>
              <h1 className={styles.heroTitle}>
                {COPY.hero.titleHead}
                <TypewriterRotator words={COPY.hero.rotatingWords} />
                {COPY.hero.titleTail}
              </h1>
              <p className={styles.heroSubtitle}>{COPY.hero.subtitle}</p>
              <div className={styles.heroActions}>
                <Link to="/login" className={styles.btnPrimary}>
                  <SparklesIcon />
                  {COPY.hero.ctaPrimary}
                </Link>
                <a href="#how" className={styles.btnGhost}>
                  {COPY.hero.ctaGhost}
                </a>
              </div>
              <p className={styles.heroFootnote}>{COPY.hero.footnote}</p>
            </div>

            <div className={`${styles.composerWrap} reveal-on-mount`}>
              <ComposerArrow />
              <div className={styles.composerCard}>
                <ComposerBrackets />
                <div className={styles.composerHead}>
                  <span className={styles.composerTitle}>
                    <span className={styles.composerTitleDot} />
                    {COPY.composer.title}
                  </span>
                  <span className={styles.composerTag}>{COPY.composer.tag}</span>
                </div>
                <textarea
                  ref={composerRef}
                  className={styles.composerTextarea}
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  placeholder={COPY.composer.placeholder}
                  rows={3}
                  aria-label="Задача для демо"
                />
                <div className={styles.composerFoot}>
                  <span className={styles.composerRate}>{COPY.composer.rate}</span>
                  <button
                    type="button"
                    className={styles.composerRunBtn}
                    onClick={() => void runDemo()}
                    disabled={busy}
                  >
                    {busy ? `${COPY.composer.submitting}…` : COPY.composer.submit}
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
                      <button
                        type="button"
                        className={styles.composerActionBtn}
                        onClick={copyResult}
                      >
                        {COPY.composer.actions.copy}
                      </button>
                      <button
                        type="button"
                        className={styles.composerActionBtn}
                        onClick={openInStudio}
                      >
                        {COPY.composer.actions.openStudio}
                      </button>
                      <button
                        type="button"
                        className={styles.composerActionBtn}
                        onClick={() => void runDemo()}
                      >
                        {COPY.composer.actions.regen}
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
              {'status' in item && item.status ? (
                <span className={`${styles.tickerDot} ${styles[item.status]}`} />
              ) : null}
            </span>
          ))}
        </div>
      </div>

      {/* ============ HOW — 3 cards in a row ============ */}
      <section className={styles.section} id="how">
        <div className={styles.container}>
          <header className={styles.sectionHead}>
            <span className={styles.sectionNum}>{COPY.how.num}</span>
            <div>
              <h2 className={styles.sectionTitle}>{COPY.how.title}</h2>
              <p className={styles.sectionLede}>{COPY.how.lede}</p>
            </div>
          </header>
          <div className={styles.howGrid}>
            {COPY.how.cards.map((c) => (
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

      {/* ============ FOR WHO — compact 2 chips ============ */}
      <section className={styles.forWho}>
        <div className={styles.container}>
          <header className={styles.sectionHead}>
            <span className={styles.sectionNum}>{COPY.forWho.num}</span>
            <div>
              <h2 className={styles.sectionTitle}>{COPY.forWho.title}</h2>
            </div>
          </header>
          <div className={styles.forWhoGrid}>
            <article className={styles.forWhoCol}>
              <div className={styles.forWhoHead}>
                <span className={`${styles.forWhoBadge} ${styles.beginner}`}>
                  {COPY.forWho.beginner.badge}
                </span>
                <h3 className={styles.forWhoTitle}>{COPY.forWho.beginner.title}</h3>
              </div>
              <ul className={styles.forWhoList}>
                {COPY.forWho.beginner.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </article>
            <article className={styles.forWhoCol}>
              <div className={styles.forWhoHead}>
                <span className={`${styles.forWhoBadge} ${styles.engineer}`}>
                  {COPY.forWho.engineer.badge}
                </span>
                <h3 className={styles.forWhoTitle}>{COPY.forWho.engineer.title}</h3>
              </div>
              <ul className={styles.forWhoList}>
                {COPY.forWho.engineer.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </article>
          </div>
        </div>
      </section>

      {/* ============ TRUST — horizontal band ============ */}
      {/* TODO(phase-9): swap mock cells for GET /api/public/model-health-snapshot. */}
      <section className={styles.section}>
        <div className={styles.container}>
          <header className={styles.sectionHead}>
            <span className={styles.sectionNum}>{COPY.trust.num}</span>
            <div>
              <h2 className={styles.sectionTitle}>{COPY.trust.title}</h2>
              <p className={styles.sectionLede}>{COPY.trust.lede}</p>
            </div>
          </header>
          <div className={styles.trustBar}>
            {COPY.trust.cells.map((c) => (
              <div key={`${c.label}-${c.mode}`} className={styles.trustCell}>
                <div className={styles.trustInfo}>
                  <span className={styles.trustLabel}>{c.label}</span>
                  <span className={styles.trustMode}>{c.mode}</span>
                </div>
                <span className={`${styles.trustDot} ${styles[c.status]}`} />
              </div>
            ))}
          </div>
          <p className={styles.trustFootnote}>{COPY.trust.footnote}</p>
        </div>
      </section>

      {/* ============ FAQ ============ */}
      <section className={styles.section}>
        <div className={styles.container}>
          <header className={styles.sectionHead}>
            <span className={styles.sectionNum}>{COPY.faq.num}</span>
            <div>
              <h2 className={styles.sectionTitle}>{COPY.faq.title}</h2>
            </div>
          </header>
          <div className={styles.faqList}>
            {COPY.faq.rows.map((row) => (
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
            <span>MetaPrompt · 2026</span>
            <div className={styles.footerLinks}>
              <Link to="/login">Войти</Link>
              <a href="https://github.com" target="_blank" rel="noreferrer noopener">
                GitHub
              </a>
              <a href="#how">Как работает</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
