import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

import '@fontsource-variable/plus-jakarta-sans/wght.css'
import '@fontsource-variable/inter/wght.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
import '@fontsource/source-serif-4/500-italic.css'
import '@fontsource/source-serif-4/600-italic.css'

/** DM Sans не в начальном бандле для всех: грузим только если уже выбран в prefs. */
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
