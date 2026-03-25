import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import styles from './PrivateOnlyMessage.module.css'

export default function PrivateOnlyMessage() {
  const { enterDemoMode } = useAuth()
  const navigate = useNavigate()

  const handleDemo = () => {
    enterDemoMode()
    navigate('/')
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.icon}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>
      <h3 className={styles.title}>Требуется вход</h3>
      <p className={styles.text}>
        Войдите в аккаунт, чтобы открыть этот раздел.
      </p>
      <div className={styles.actions}>
        <Link to="/login" className={styles.primaryBtn}>Войти</Link>
        <button className={styles.secondaryBtn} onClick={handleDemo}>
          Попробовать без регистрации
        </button>
      </div>
    </div>
  )
}
