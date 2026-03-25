import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import styles from './Auth.module.css'

// Icons as inline SVGs for simplicity
const UserIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
)

const LockIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
)

const SparklesIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    <path d="M5 3v4" />
    <path d="M19 17v4" />
    <path d="M3 5h4" />
    <path d="M17 19h4" />
  </svg>
)

const ArrowRightIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
)

export default function AuthPage() {
  const { login, register, enterDemoMode } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focusedField, setFocusedField] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    if (mode === 'register' && password !== password2) {
      setError('Пароли не совпадают')
      return
    }
    setLoading(true)
    try {
      if (mode === 'login') await login(username, password)
      else await register(username, password)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка авторизации')
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && username && password) {
      submit()
    }
  }

  return (
    <div className={styles.authPage}>
      {/* Background Effects */}
      <div className={styles.bgEffects}>
        <div className={styles.gradientOrb1} />
        <div className={styles.gradientOrb2} />
        <div className={styles.gradientOrb3} />
        <div className={styles.gridPattern} />
      </div>

      <div className={styles.container}>
        {/* Left Side - Branding */}
        <div className={styles.brandingSide}>
          <div className={styles.brandingContent}>
            <div className={styles.logoWrapper}>
              <div className={styles.logo}>
                <SparklesIcon />
              </div>
            </div>
            <h1 className={styles.brandTitle}>Prompt Engineer</h1>
            <p className={styles.brandSubtitle}>
              Оптимизируй промпты с помощью AI. Создавай, тестируй и улучшай свои промпты в одном месте.
            </p>
            
            <div className={styles.features}>
              <div className={styles.feature}>
                <div className={styles.featureIcon}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                </div>
                <span>Библиотека промптов</span>
              </div>
              <div className={styles.feature}>
                <div className={styles.featureIcon}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 3v18h18" />
                    <path d="m19 9-5 5-4-4-3 3" />
                  </svg>
                </div>
                <span>Аналитика и метрики</span>
              </div>
              <div className={styles.feature}>
                <div className={styles.featureIcon}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 6v6l4 2" />
                  </svg>
                </div>
                <span>История версий</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side - Form */}
        <div className={styles.formSide}>
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2>{mode === 'login' ? 'Добро пожаловать' : 'Создать аккаунт'}</h2>
              <p className={styles.cardCaption}>
                {mode === 'login' 
                  ? 'Войдите, чтобы продолжить работу' 
                  : 'Зарегистрируйтесь для начала работы'}
              </p>
            </div>

            <div className={styles.tabs}>
              <button 
                className={`${styles.tab} ${mode === 'login' ? styles.tabActive : ''}`} 
                onClick={() => setMode('login')}
              >
                Вход
              </button>
              <button 
                className={`${styles.tab} ${mode === 'register' ? styles.tabActive : ''}`} 
                onClick={() => setMode('register')}
              >
                Регистрация
              </button>
              <div 
                className={styles.tabIndicator} 
                style={{ transform: mode === 'register' ? 'translateX(100%)' : 'translateX(0)' }}
              />
            </div>

            <div className={styles.form} onKeyDown={handleKeyDown}>
              <div className={`${styles.inputGroup} ${focusedField === 'username' ? styles.focused : ''}`}>
                <div className={styles.inputIcon}>
                  <UserIcon />
                </div>
                <input 
                  type="text"
                  value={username} 
                  onChange={(e) => setUsername(e.target.value)} 
                  onFocus={() => setFocusedField('username')}
                  onBlur={() => setFocusedField(null)}
                  placeholder="Имя пользователя"
                  autoComplete="username"
                />
              </div>

              <div className={`${styles.inputGroup} ${focusedField === 'password' ? styles.focused : ''}`}>
                <div className={styles.inputIcon}>
                  <LockIcon />
                </div>
                <input 
                  type="password" 
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocusedField('password')}
                  onBlur={() => setFocusedField(null)}
                  placeholder="Пароль"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
              </div>

              {mode === 'register' && (
                <div className={`${styles.inputGroup} ${focusedField === 'password2' ? styles.focused : ''} ${styles.slideIn}`}>
                  <div className={styles.inputIcon}>
                    <LockIcon />
                  </div>
                  <input 
                    type="password" 
                    value={password2} 
                    onChange={(e) => setPassword2(e.target.value)}
                    onFocus={() => setFocusedField('password2')}
                    onBlur={() => setFocusedField(null)}
                    placeholder="Повторите пароль"
                    autoComplete="new-password"
                  />
                </div>
              )}

              {error && (
                <div className={styles.errorMessage}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>{error}</span>
                </div>
              )}

              <button 
                className={styles.primaryButton} 
                onClick={submit} 
                disabled={loading || !username || !password}
              >
                <span>{loading ? 'Подождите...' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}</span>
                {!loading && <ArrowRightIcon />}
                {loading && <div className={styles.spinner} />}
              </button>
              
              <div className={styles.divider}>
                <span>или</span>
              </div>
              
              <button 
                className={styles.secondaryButton} 
                onClick={enterDemoMode}
                type="button"
              >
                <SparklesIcon />
                <span>Войти как гость (Demo)</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
