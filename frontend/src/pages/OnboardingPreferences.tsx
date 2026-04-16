import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'

const PRESETS = [
  { value: 'balanced', label: 'Сбалансированный простой режим' },
  { value: 'creative', label: 'Больше креатива' },
  { value: 'precise', label: 'Больше точности' },
] as const

export default function OnboardingPreferences() {
  const navigate = useNavigate()
  const [taskMode, setTaskMode] = useState<'heuristic' | 'llm'>('heuristic')
  const [preset, setPreset] = useState<string>('balanced')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      await api.updateSettings({
        task_classification_mode: taskMode,
        simple_improve_preset: preset,
      })
      navigate('/home', { replace: true })
    } finally {
      setBusy(false)
    }
  }

  const skip = () => navigate('/home', { replace: true })

  return (
    <div style={{ maxWidth: 520, margin: '48px auto', padding: 24 }}>
      <h1 className="pageTitleGradient" style={{ marginBottom: 12 }}>
        Настроим под тебя
      </h1>
      <p style={{ opacity: 0.88, marginBottom: 24 }}>
        Три коротких шага — всё можно изменить позже в настройках.{' '}
        <Link to="/help">Справка</Link>.
      </p>
      <label style={{ display: 'block', marginBottom: 16 }}>
        <div style={{ marginBottom: 6, fontWeight: 600 }}>Классификация задачи</div>
        <select
          value={taskMode}
          onChange={(e) => setTaskMode(e.target.value as 'heuristic' | 'llm')}
          style={{ width: '100%', padding: 8, borderRadius: 8 }}
        >
          <option value="heuristic">Быстрая эвристика (по умолчанию)</option>
          <option value="llm">Через LLM (точнее, дороже)</option>
        </select>
      </label>
      <div style={{ marginBottom: 20 }}>
        <div style={{ marginBottom: 6, fontWeight: 600 }}>Пресет «Улучшить»</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {PRESETS.map((p) => (
            <label key={p.value} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="radio"
                name="preset"
                checked={preset === p.value}
                onChange={() => setPreset(p.value)}
              />
              {p.label}
            </label>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          style={{ padding: '10px 16px', borderRadius: 8, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}
        >
          Сохранить и перейти в студию
        </button>
        <button type="button" disabled={busy} onClick={skip}>
          Пропустить
        </button>
      </div>
    </div>
  )
}
