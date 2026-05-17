import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import { LanguageProvider } from './i18n'
import Layout from './components/Layout'
import AppRouteSkeleton from './components/AppRouteSkeleton'
import PrivateOnlyMessage from './components/PrivateOnlyMessage'
import CommandPalette from './components/CommandPalette'
import AuthPage from './pages/Auth'
import RootRedirect from './pages/RootRedirect'
import Welcome from './pages/Welcome'

const Home = lazy(() => import('./pages/Home'))
const Compare = lazy(() => import('./pages/Compare'))
const Library = lazy(() => import('./pages/Library'))
const Models = lazy(() => import('./pages/Models'))
const Settings = lazy(() => import('./pages/Settings'))
const UserInfo = lazy(() => import('./pages/UserInfo'))
const Workspaces = lazy(() => import('./pages/Workspaces'))
const Techniques = lazy(() => import('./pages/Techniques'))
const SimpleImprove = lazy(() => import('./pages/SimpleImprove'))
const Community = lazy(() => import('./pages/Community'))
const Help = lazy(() => import('./pages/Help'))
const EvalStudio = lazy(() => import('./pages/EvalStudio'))
const Onboarding = lazy(() => import('./pages/Onboarding'))
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'))
const AdminUserDetail = lazy(() => import('./pages/admin/AdminUserDetail'))
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'))
const AdminCommunity = lazy(() => import('./pages/admin/AdminCommunity'))

function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<AppRouteSkeleton />}>{children}</Suspense>
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <AppRouteSkeleton />
  if (!user) return <PrivateOnlyMessage />
  return <>{children}</>
}

const MARKETING_PATHS = new Set<string>(['/welcome', '/login', '/onboarding'])

function AppShell() {
  const { user, loading } = useAuth()
  const location = useLocation()

  useEffect(() => {
    const isMarketing = MARKETING_PATHS.has(location.pathname)
    if (typeof document !== 'undefined') {
      document.body.classList.toggle('register-marketing', isMarketing)
      document.body.classList.toggle('register-product', !isMarketing)
    }
  }, [location.pathname])

  if (loading) return <AppRouteSkeleton />

  if (location.pathname === '/login') {
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
        <Route path="/" element={<RootRedirect />} />
        <Route path="/welcome" element={<Welcome />} />

        <Route path="/home" element={<RequireAuth><LazyPage><Home /></LazyPage></RequireAuth>} />
        <Route path="/onboarding" element={<RequireAuth><LazyPage><Onboarding /></LazyPage></RequireAuth>} />
        <Route path="/admin" element={<RequireAuth><LazyPage><AdminDashboard /></LazyPage></RequireAuth>} />
        <Route path="/admin/users" element={<RequireAuth><LazyPage><AdminUsers /></LazyPage></RequireAuth>} />
        <Route path="/admin/users/:userId" element={<RequireAuth><LazyPage><AdminUserDetail /></LazyPage></RequireAuth>} />
        <Route path="/admin/community" element={<RequireAuth><LazyPage><AdminCommunity /></LazyPage></RequireAuth>} />
        <Route path="/simple" element={<RequireAuth><LazyPage><SimpleImprove /></LazyPage></RequireAuth>} />
        <Route path="/compare" element={<RequireAuth><LazyPage><Compare /></LazyPage></RequireAuth>} />
        <Route path="/eval" element={<RequireAuth><LazyPage><EvalStudio /></LazyPage></RequireAuth>} />
        <Route path="/library" element={<RequireAuth><LazyPage><Library /></LazyPage></RequireAuth>} />
        <Route path="/community" element={<RequireAuth><LazyPage><Community /></LazyPage></RequireAuth>} />
        <Route path="/techniques" element={<RequireAuth><LazyPage><Techniques /></LazyPage></RequireAuth>} />
        <Route path="/workspaces" element={<RequireAuth><LazyPage><Workspaces /></LazyPage></RequireAuth>} />
        <Route path="/presets" element={<RequireAuth><Navigate to="/library?tab=presets" replace /></RequireAuth>} />
        <Route path="/models" element={<RequireAuth><LazyPage><Models /></LazyPage></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><LazyPage><Settings /></LazyPage></RequireAuth>} />
        <Route path="/user-info" element={<RequireAuth><LazyPage><UserInfo /></LazyPage></RequireAuth>} />
        <Route path="/help" element={<RequireAuth><LazyPage><Help /></LazyPage></RequireAuth>} />

        <Route path="/metrics" element={<Navigate to="/user-info#product-metrics" replace />} />

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
