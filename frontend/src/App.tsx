import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import PrivateOnlyMessage from './components/PrivateOnlyMessage'
import AuthPage from './pages/Auth'
import Landing from './pages/Landing'
import Home from './pages/Home'
import Compare from './pages/Compare'
import Library from './pages/Library'
import Models from './pages/Models'
import Settings from './pages/Settings'
import UserInfo from './pages/UserInfo'
import Workspaces from './pages/Workspaces'
import Presets from './pages/Presets'
import SimpleImprove from './pages/SimpleImprove'
import Community from './pages/Community'
import Help from './pages/Help'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ padding: 24 }}>Загрузка…</div>
  if (!user) return <PrivateOnlyMessage />
  return <>{children}</>
}

function AppShell() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <div style={{ padding: 24 }}>Загрузка…</div>

  // Auth page (login) — no Layout wrapper
  if (location.pathname === '/login') {
    // If already logged in, redirect to home
    if (user) return <Navigate to="/home" replace />
    return <AuthPage />
  }

  return (
    <Layout>
      <Routes>
        {/* Public */}
        <Route path="/" element={<Landing />} />

        {/* Private */}
        <Route path="/home" element={<RequireAuth><Home /></RequireAuth>} />
        <Route path="/simple" element={<RequireAuth><SimpleImprove /></RequireAuth>} />
        <Route path="/compare" element={<RequireAuth><Compare /></RequireAuth>} />
        <Route path="/library" element={<RequireAuth><Library /></RequireAuth>} />
        <Route path="/community" element={<RequireAuth><Community /></RequireAuth>} />
        <Route path="/techniques" element={<RequireAuth><Navigate to="/library?tab=techniques" replace /></RequireAuth>} />
        <Route path="/workspaces" element={<RequireAuth><Workspaces /></RequireAuth>} />
        <Route path="/presets" element={<RequireAuth><Presets /></RequireAuth>} />
        <Route path="/models" element={<RequireAuth><Models /></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
        <Route path="/user-info" element={<RequireAuth><UserInfo /></RequireAuth>} />
        <Route path="/help" element={<RequireAuth><Help /></RequireAuth>} />

        {/* Redirects */}
        <Route path="/metrics" element={<Navigate to="/user-info#product-metrics" replace />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

export default function App() {
  return (
    <div className="appRoot">
      <AuthProvider>
        <ThemeProvider>
          <AppShell />
        </ThemeProvider>
      </AuthProvider>
    </div>
  )
}
