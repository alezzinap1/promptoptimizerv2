import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { api, setAuthSessionId, type User } from '../api/client'

interface AuthContextType {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    try {
      const res = await api.me()
      setUser(res.user)
    } catch {
      setAuthSessionId(null)
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const login = async (username: string, password: string) => {
    const res = await api.login({ username, password })
    setAuthSessionId(res.session_id)
    setUser(res.user)
  }

  const register = async (username: string, password: string) => {
    const res = await api.register({ username, password })
    setAuthSessionId(res.session_id)
    setUser(res.user)
  }

  const logout = async () => {
    try {
      await api.logout()
    } finally {
      setAuthSessionId(null)
      setUser(null)
    }
  }

  const value = useMemo(
    () => ({ user, loading, login, register, logout, refresh }),
    [user, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
