import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import styles from './Auth.module.css'

export default function AuthPage() {
  const { login, register, enterDemoMode } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className={styles.authPage}>
      <div className={styles.card}>
        <h1>Prompt Engineer</h1>
        <p className={styles.caption}>Войди в аккаунт, чтобы работать с библиотекой, history, workspace и метриками.</p>

        <div className={styles.tabs}>
          <button className={mode === 'login' ? styles.tabActive : styles.tab} onClick={() => setMode('login')}>
            Login
          </button>
          <button className={mode === 'register' ? styles.tabActive : styles.tab} onClick={() => setMode('register')}>
            Register
          </button>
        </div>

        <div className={styles.form}>
          <label>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="your_name" />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {mode === 'register' && (
            <label>
              Repeat password
              <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
            </label>
          )}
          {error && <p className={styles.error}>{error}</p>}
          <button className={styles.primary} onClick={submit} disabled={loading || !username || !password}>
            {loading ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
          </button>
          
          <div className={styles.divider}>
            <span>или</span>
          </div>
          
          <button 
            className={styles.secondary} 
            onClick={enterDemoMode}
            type="button"
          >
            Войти как гость (Demo)
          </button>
        </div>
      </div>
    </div>
  )
}
