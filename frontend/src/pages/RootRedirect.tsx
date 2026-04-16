import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

/** `/` → `/welcome` (guest) or `/home` (signed in). */
export default function RootRedirect() {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ padding: 24 }}>Загрузка…</div>
  if (user) return <Navigate to="/home" replace />
  return <Navigate to="/welcome" replace />
}
