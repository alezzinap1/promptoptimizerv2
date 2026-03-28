import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { setAuthSessionId } from '../api/client'
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

const MailIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="20" height="16" x="2" y="4" rx="2" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
  </svg>
)

const GitHubIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
  </svg>
)

export default function AuthPage() {
  const { user: currentUser, login, register, enterDemoMode, refresh } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focusedField, setFocusedField] = useState<string | null>(null)

  // Redirect if already logged in
  useEffect(() => {
    if (currentUser) navigate('/home', { replace: true })
  }, [currentUser])

  // Handle GitHub OAuth callback: /login?session=XXX or /login?error=XXX
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const sessionFromGitHub = params.get('session')
    const githubError = params.get('error')

    if (sessionFromGitHub) {
      setLoading(true)
      setAuthSessionId(sessionFromGitHub)
      refresh()
        .then(() => navigate('/home', { replace: true }))
        .catch(() => {
          setAuthSessionId(null)
          setError('Не удалось войти через GitHub. Попробуйте ещё раз.')
        })
        .finally(() => setLoading(false))
      // Clean URL
      window.history.replaceState({}, '', '/login')
    } else if (githubError) {
      setError('Не удалось войти через GitHub. Попробуйте ещё раз.')
      window.history.replaceState({}, '', '/login')
    }
  }, [])

  const submit = async () => {
    setError(null)
    if (mode === 'register') {
      if (password !== password2) {
        setError('Пароли не совпадают')
        return
      }
      if (!email.trim()) {
        setError('Укажите email')
        return
      }
    }
    setLoading(true)
    try {
      if (mode === 'login') await login(username, password)
      else await register(username, password, email.trim())
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
        <div className={styles.bgOrb1} />
        <div className={styles.bgOrb2} />
        <div className={styles.bgOrb3} />
        <div className={styles.gridPattern} />
      </div>

      <div className={styles.container}>
        {/* Left Side - Branding */}
        <div className={styles.brandingSide}>
          <div className={styles.brandingContent}>
            <div className={styles.logoWrapper}>
              <div className={styles.logo}>
                <span className={styles.brandLogoGlyph} aria-hidden />
              </div>
            </div>
            <h1 className={styles.brandTitle}>MetaPrompt</h1>
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

              {mode === 'register' && (
                <div className={`${styles.inputGroup} ${focusedField === 'email' ? styles.focused : ''} ${styles.slideIn}`}>
                  <div className={styles.inputIcon}>
                    <MailIcon />
                  </div>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onFocus={() => setFocusedField('email')}
                    onBlur={() => setFocusedField(null)}
                    placeholder="Email"
                    autoComplete="email"
                  />
                </div>
              )}

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
                disabled={loading || !username || !password || (mode === 'register' && !email)}
              >
                <span>{loading ? 'Подождите...' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}</span>
                {!loading && <ArrowRightIcon />}
                {loading && <div className={styles.spinner} />}
              </button>
              
              <div className={styles.divider}>
                <span>или</span>
              </div>

              <a
                href="/api/auth/github"
                className={styles.githubButton}
              >
                <GitHubIcon />
                <span>{mode === 'login' ? 'Войти через GitHub' : 'Зарегистрироваться через GitHub'}</span>
              </a>

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
