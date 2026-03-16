import { Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import AuthPage from './pages/Auth'
import Home from './pages/Home'
import Compare from './pages/Compare'
import Library from './pages/Library'
import Techniques from './pages/Techniques'
import Metrics from './pages/Metrics'
import Models from './pages/Models'
import Settings from './pages/Settings'
import Workspaces from './pages/Workspaces'

function AppShell() {
  const { user, loading } = useAuth()

  if (loading) return <div style={{ padding: 24 }}>Загрузка…</div>
  if (!user) return <AuthPage />

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/compare" element={<Compare />} />
        <Route path="/library" element={<Library />} />
        <Route path="/techniques" element={<Techniques />} />
        <Route path="/metrics" element={<Metrics />} />
        <Route path="/workspaces" element={<Workspaces />} />
        <Route path="/models" element={<Models />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Layout>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </ThemeProvider>
  )
}
