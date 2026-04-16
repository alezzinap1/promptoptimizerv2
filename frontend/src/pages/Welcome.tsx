import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
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

  if (user) return <Navigate to="/home" replace />

  const handleDemo = () => {
    enterDemoMode()
    navigate('/home')
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
