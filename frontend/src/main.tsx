import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

/** DM Sans не в начальном бандле: грузим только если уже выбран в prefs (без FOIT для этих пользователей). */
try {
  const raw = localStorage.getItem('prompt-engineer-prefs')
  if (raw) {
    const font = (JSON.parse(raw) as { font?: string }).font?.toLowerCase()
    if (font === 'dmsans') {
      void import('@fontsource-variable/dm-sans/wght.css')
    }
  }
} catch {
  /* ignore */
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
