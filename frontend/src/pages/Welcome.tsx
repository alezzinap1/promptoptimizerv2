import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../api/client'
import styles from './Landing.module.css'

const SparklesIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    <path d="M5 3v4" />
    <path d="M19 17v4" />
    <path d="M3 5h4" />
    <path d="M17 19h4" />
  </svg>
)

const features = [
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
    title: 'Оптимизация промптов',
    desc: 'Улучшай промпты с помощью AI-техник — Chain-of-Thought, Few-Shot и других.',
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
    title: 'Библиотека промптов',
    desc: 'Сохраняй и организуй коллекцию промптов с историей версий.',
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
    title: 'Сравнение A/B техник',
    desc: 'Одна задача и одна модель генерации — два набора техник и два промпта рядом для сравнения.',
  },
  {
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 3v18h18" />
        <path d="m19 9-5 5-4-4-3 3" />
      </svg>
    ),
    title: 'Аналитика',
    desc: 'Отслеживай использование токенов и стоимость генераций.',
  },
]

export default function Welcome() {
  const { user, enterDemoMode } = useAuth()
  const navigate = useNavigate()
  const [demoTask, setDemoTask] = useState('')
  const [demoBusy, setDemoBusy] = useState(false)
  const [demoResult, setDemoResult] = useState<string>('')
  const [demoError, setDemoError] = useState<string | null>(null)

  if (user) return <Navigate to="/home" replace />

  const handleDemo = () => {
    enterDemoMode()
    navigate('/home')
  }

  const runQuickDemo = async () => {
    const task = demoTask.trim()
    if (task.length < 3) {
      setDemoError('Опишите задачу хотя бы одним предложением.')
      return
    }
    setDemoBusy(true)
    setDemoError(null)
    setDemoResult('')
    try {
      const r = await api.demoGenerate(task)
      setDemoResult(r.prompt_block)
    } catch (e) {
      setDemoError(e instanceof Error ? e.message : 'Демо временно недоступно.')
    } finally {
      setDemoBusy(false)
    }
  }

  return (
    <div className={styles.landing}>
      <div className={styles.content}>
        <div className={styles.hero}>
          <div className={styles.logoWrap}>
            <div className={styles.logoIcon}>
              <span className={styles.heroLogoGlyph} aria-hidden />
            </div>
          </div>

          <h1 className={styles.title}>MetaPrompt</h1>
          <p className={styles.subtitle}>
            Инструмент для тех, кто хочет получать от языковых моделей предсказуемый результат: формулируешь задачу,
            получаешь структурированный промпт, итерируешь и сохраняешь удачные версии в библиотеку.
          </p>
          <p className={styles.subtitle} style={{ marginTop: 12, fontSize: '0.95rem', opacity: 0.92 }}>
            Демо позволяет посмотреть интерфейс без входа — без сохранения на сервере. С аккаунтом доступны библиотека,
            рабочие пространства и полноценная генерация. Для работы с моделями через облако нужен свой ключ OpenRouter
            (его можно добавить в настройках после входа); без ключа в пробном режиме действуют лимиты хоста.
          </p>

          <div className={styles.actions}>
            <Link to="/login" className={styles.primaryBtn}>
              Войти или зарегистрироваться
            </Link>
            <button type="button" className={styles.secondaryBtn} onClick={handleDemo}>
              <SparklesIcon />
              Попробовать без регистрации
            </button>
          </div>

          <div
            style={{
              marginTop: 28,
              padding: 16,
              border: '1px solid rgba(255,255,255,0.09)',
              borderRadius: 14,
              background: 'rgba(255,255,255,0.03)',
              textAlign: 'left',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Быстрое демо — одна генерация прямо здесь
            </div>
            <p style={{ fontSize: 12, opacity: 0.75, margin: '0 0 10px' }}>
              Введите задачу одним предложением. Мы соберём для неё готовый структурированный промпт.
              Без входа и ключей. Лимит: 5 запросов в 5 минут с одного IP.
            </p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
              <textarea
                rows={2}
                value={demoTask}
                onChange={(e) => setDemoTask(e.target.value)}
                placeholder="Например: напиши промпт для генерации описания товара в интернет-магазине."
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  fontSize: 13,
                  background: 'rgba(0,0,0,0.25)',
                  color: 'inherit',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 8,
                  resize: 'vertical',
                }}
              />
              <button
                type="button"
                onClick={() => void runQuickDemo()}
                disabled={demoBusy}
                className={styles.primaryBtn}
                style={{ whiteSpace: 'nowrap' }}
              >
                {demoBusy ? 'Генерирую…' : 'Сгенерировать'}
              </button>
            </div>
            {demoError ? (
              <p style={{ color: '#f87171', fontSize: 12, marginTop: 8 }}>{demoError}</p>
            ) : null}
            {demoResult ? (
              <pre
                style={{
                  marginTop: 10,
                  padding: 12,
                  background: 'rgba(0,0,0,0.35)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 10,
                  whiteSpace: 'pre-wrap',
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  maxHeight: 360,
                  overflow: 'auto',
                }}
              >
                {demoResult}
              </pre>
            ) : null}
          </div>
        </div>

        <div className={styles.features}>
          {features.map((f) => (
            <div key={f.title} className={styles.featureCard}>
              <div className={styles.featureIcon}>{f.icon}</div>
              <div>
                <div className={styles.featureTitle}>{f.title}</div>
                <div className={styles.featureDesc}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
