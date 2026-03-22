import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import {
  SIMPLE_PRESET_IDS,
  SIMPLE_PRESET_LABELS,
  type SimplePresetId,
} from '../constants/simpleImprove'
import styles from './SimpleImprove.module.css'

export default function SimpleImprove() {
  const [promptText, setPromptText] = useState('')
  const [preset, setPreset] = useState<SimplePresetId>('balanced')
  const [genModel, setGenModel] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [result, setResult] = useState('')
  const [metaHint, setMetaHint] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        const list = s.preferred_generation_models || []
        setModels(list)
        setGenModel((prev) => prev || list[0] || '')
        const p = s.simple_improve_preset as SimplePresetId
        if (SIMPLE_PRESET_IDS.includes(p)) setPreset(p)
        if (s.simple_improve_meta?.trim()) setMetaHint('В настройках задан дополнительный мета-промпт — он учитывается автоматически.')
        else setMetaHint('')
      })
      .catch(() => {})
  }, [])

  const run = async () => {
    const t = promptText.trim()
    if (!t) {
      setError('Вставьте текст промпта.')
      return
    }
    setLoading(true)
    setError(null)
    setResult('')
    setCopied(false)
    try {
      const res = await api.simpleImprove({
        prompt_text: t,
        preset,
        gen_model: genModel.trim() || undefined,
      })
      if (!res.improved_text?.trim()) {
        setError('Модель вернула пустой ответ. Попробуйте ещё раз или смените модель.')
      } else {
        setResult(res.improved_text)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка запроса')
    } finally {
      setLoading(false)
    }
  }

  const copy = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Не удалось скопировать в буфер')
    }
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Простой режим</h1>
          <p className={styles.lead}>
            Вставьте промпт и нажмите кнопку — получите улучшенный текст.{' '}
            <Link to="/help">Справка</Link>
            {' · '}
            <Link to="/settings">Настройки пресета и мета-промпта</Link>
          </p>
        </div>
      </header>

      {metaHint && <p className={styles.hint}>{metaHint}</p>}

      <div className={styles.controls}>
        <label className={styles.label}>
          Пресет для этого запроса
          <select
            className={styles.select}
            value={preset}
            onChange={(e) => setPreset(e.target.value as SimplePresetId)}
          >
            {SIMPLE_PRESET_IDS.map((id) => (
              <option key={id} value={id}>
                {SIMPLE_PRESET_LABELS[id]}
              </option>
            ))}
          </select>
        </label>
        {models.length > 0 && (
          <label className={styles.label}>
            Модель
            <select
              className={styles.select}
              value={genModel}
              onChange={(e) => setGenModel(e.target.value)}
            >
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <textarea
        className={styles.textarea}
        placeholder="Ваш промпт…"
        value={promptText}
        onChange={(e) => setPromptText(e.target.value)}
        rows={12}
        spellCheck
      />

      <div className={styles.actions}>
        <button type="button" className={styles.primaryBtn} onClick={run} disabled={loading}>
          {loading ? 'Улучшаем…' : 'Улучшить промпт'}
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {result && (
        <section className={styles.output}>
          <div className={styles.outputHead}>
            <h2 className={styles.outputTitle}>Результат</h2>
            <button type="button" className={styles.secondaryBtn} onClick={copy}>
              {copied ? 'Скопировано' : 'Копировать'}
            </button>
          </div>
          <pre className={styles.result}>{result}</pre>
        </section>
      )}
    </div>
  )
}
