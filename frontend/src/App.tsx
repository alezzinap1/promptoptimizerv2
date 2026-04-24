import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import { LanguageProvider, useT } from './i18n'
import Layout from './components/Layout'
import PrivateOnlyMessage from './components/PrivateOnlyMessage'
import CommandPalette from './components/CommandPalette'
import AuthPage from './pages/Auth'
import RootRedirect from './pages/RootRedirect'
import Welcome from './pages/Welcome'
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
import Onboarding from './pages/Onboarding'
import AdminUsers from './pages/admin/AdminUsers'
import AdminUserDetail from './pages/admin/AdminUserDetail'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminCommunity from './pages/admin/AdminCommunity'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const { t } = useT()
  if (loading) return <div style={{ padding: 24 }}>{t.common.loading}</div>
  if (!user) return <PrivateOnlyMessage />
  return <>{children}</>
}

const MARKETING_PATHS = new Set<string>(['/welcome', '/login', '/onboarding'])

function AppShell() {
  const { user, loading } = useAuth()
  const { t } = useT()
  const location = useLocation()

  // Register switch: marketing (cream editorial) for public/onboarding surfaces,
  // product (user's chosen theme) elsewhere. Applied via <body> class; see
  // frontend/src/styles/marketing-register.css and spec §4.1.
  useEffect(() => {
    const isMarketing = MARKETING_PATHS.has(location.pathname)
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('register-marketing', isMarketing)
      document.body.classList.toggle('register-product', !isMarketing)
    }
  }, [location.pathname])

  if (loading) return <div style={{ padding: 24 }}>{t.common.loading}</div>

  // Auth page (login) — no Layout wrapper
  if (location.pathname === '/login') {
    // If already logged in, redirect to home
    if (user) return <Navigate to="/home" replace />
    return (
      <>
        <AuthPage />
        <CommandPalette />
      </>
    )
  }

  return (
    <Layout>
      <CommandPalette />
      <Routes>
        {/* Public */}
        <Route path="/" element={<RootRedirect />} />
        <Route path="/welcome" element={<Welcome />} />

        {/* Private */}
        <Route path="/home" element={<RequireAuth><Home /></RequireAuth>} />
        <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
        <Route path="/admin" element={<RequireAuth><AdminDashboard /></RequireAuth>} />
        <Route path="/admin/users" element={<RequireAuth><AdminUsers /></RequireAuth>} />
        <Route path="/admin/users/:userId" element={<RequireAuth><AdminUserDetail /></RequireAuth>} />
        <Route path="/admin/community" element={<RequireAuth><AdminCommunity /></RequireAuth>} />
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
        <Route path="*" element={<Navigate to="/welcome" replace />} />
      </Routes>
    </Layout>
  )
}

export default function App() {
  return (
    <div className="appRoot">
      <LanguageProvider>
        <AuthProvider>
          <ThemeProvider>
            <AppShell />
          </ThemeProvider>
        </AuthProvider>
      </LanguageProvider>
    </div>
  )
}
