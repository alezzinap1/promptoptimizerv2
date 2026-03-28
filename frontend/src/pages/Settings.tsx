import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api, type Settings } from '../api/client'
import {
  SIMPLE_PRESET_IDS,
  SIMPLE_PRESET_LABELS,
  type SimplePresetId,
} from '../constants/simpleImprove'
import { FONTS, PALETTES, useTheme } from '../context/ThemeContext'
import SelectDropdown from '../components/SelectDropdown'
import styles from './Settings.module.css'

const PALETTE_LABELS: Record<string, string> = {
  slate: 'Slate',
  forest: 'Forest',
  midnight: 'Midnight',
  amber: 'Amber',
  ocean: 'Ocean',
  mono: 'Monochrome',
}

const FONT_LABELS: Record<string, string> = {
  jetbrains: 'JetBrains Mono',
  inter: 'Inter',
  ibmplex: 'IBM Plex Sans',
  plusjakarta: 'Plus Jakarta Sans',
  spacegrotesk: 'Space Grotesk',
  manrope: 'Manrope',
  outfit: 'Outfit',
  firacode: 'Fira Code',
}

const CLS_MODE_OPTIONS = [
  { value: 'heuristic', label: 'Эвристика (ключевые слова)' },
  { value: 'llm', label: 'LLM-классификатор' },
] as const

const SIMPLE_PRESET_FORM_OPTIONS = SIMPLE_PRESET_IDS.map((id) => ({
  value: id,
  label: SIMPLE_PRESET_LABELS[id],
}))

export default function Settings() {
  const { palette, font, setPalette, setFont } = useTheme()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [simplePreset, setSimplePreset] = useState<SimplePresetId>('balanced')
  const [simpleMeta, setSimpleMeta] = useState('')
  const [clsMode, setClsMode] = useState<'heuristic' | 'llm'>('heuristic')
  const [clsModel, setClsModel] = useState('')

  useEffect(() => {
    api.getSettings()
      .then(setSettings)
      .catch((e) => setMessage({ type: 'err', text: e instanceof Error ? e.message : 'Не удалось загрузить настройки' }))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!settings) return
    const p = settings.simple_improve_preset as SimplePresetId
    setSimplePreset(SIMPLE_PRESET_IDS.includes(p) ? p : 'balanced')
    setSimpleMeta(settings.simple_improve_meta ?? '')
    setClsMode(settings.task_classification_mode === 'llm' ? 'llm' : 'heuristic')
    setClsModel(settings.task_classifier_model ?? '')
  }, [settings])

  const handleSaveApiKey = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const updated = await api.updateSettings({ openrouter_api_key: apiKey })
      setSettings(updated)
      setApiKey('')
      setMessage({ type: 'ok', text: 'API ключ сохранён' })
    } catch (e) {
      setMessage({ type: 'err', text: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const handleSaveSimpleImprove = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const updated = await api.updateSettings({
        simple_improve_preset: simplePreset,
        simple_improve_meta: simpleMeta,
      })
      setSettings(updated)
      setMessage({ type: 'ok', text: 'Настройки простого режима сохранены' })
    } catch (e) {
      setMessage({ type: 'err', text: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const handleSaveClassification = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const updated = await api.updateSettings({
        task_classification_mode: clsMode,
        task_classifier_model: clsModel.trim(),
      })
      setSettings(updated)
      setMessage({ type: 'ok', text: 'Классификация задачи сохранена' })
    } catch (e) {
      setMessage({ type: 'err', text: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  const handleClearApiKey = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const updated = await api.updateSettings({ openrouter_api_key: '' })
      setSettings(updated)
      setMessage({ type: 'ok', text: 'API ключ очищен' })
    } catch (e) {
      setMessage({ type: 'err', text: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.settings}>
      <h1>Настройки</h1>

      <section className={styles.section}>
        <h2>OpenRouter API</h2>
        <p className={styles.info}>
          Ваш персональный API ключ OpenRouter. Без ключа доступен пробный режим (50 000 токенов, модели ≤$1/1M).
          Ключ хранится на сервере и привязан к вашему аккаунту.
        </p>
        {settings?.openrouter_api_key_set && (
          <p className={styles.masked}>
            Текущий ключ: <code>{settings.openrouter_api_key_masked}</code>
          </p>
        )}
        {loading && <p className={styles.masked}>Загрузка текущих настроек…</p>}
        <div className={styles.row}>
          <input
            type="password"
            placeholder="sk-or-v1-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className={styles.input}
          />
          <button
            onClick={handleSaveApiKey}
            disabled={saving || !apiKey.trim()}
            className={styles.btn}
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
          <button
            onClick={handleClearApiKey}
            disabled={saving || !settings?.openrouter_api_key_set}
            className={styles.btn}
          >
            Очистить
          </button>
        </div>
        {message && (
          <p className={message.type === 'ok' ? styles.msgOk : styles.msgErr}>
            {message.text}
          </p>
        )}
      </section>

      <section className={styles.section}>
        <h2>Классификация задачи (Home)</h2>
        <p className={styles.info}>
          Определяет тип задачи и сложность для подбора техник. <strong>Эвристика</strong> — быстро и бесплатно,
          метка в запросе помечена как неточная. <strong>LLM</strong> — отдельный короткий вызов модели (токены);
          в пробном режиме при слишком дорогой модели подставится дешёвая по умолчанию.
        </p>
        <div className={styles.row}>
          <label className={styles.fieldLabel}>
            Режим
            <SelectDropdown
              value={clsMode}
              options={[...CLS_MODE_OPTIONS]}
              onChange={(v) => setClsMode(v as 'heuristic' | 'llm')}
              aria-label="Режим классификации"
              variant="field"
            />
          </label>
        </div>
        <label className={styles.fieldLabel}>
          Модель для LLM-режима (OpenRouter id или короткий ключ, напр. gemini_flash). Пусто — по умолчанию на сервере.
          <input
            className={styles.input}
            value={clsModel}
            onChange={(e) => setClsModel(e.target.value)}
            placeholder="google/gemini-flash-1.5"
            disabled={clsMode !== 'llm'}
          />
        </label>
        <div className={styles.row}>
          <button type="button" onClick={handleSaveClassification} disabled={saving || loading} className={styles.btn}>
            {saving ? 'Сохранение…' : 'Сохранить классификацию'}
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <h2>Простой режим (улучшение промпта)</h2>
        <p className={styles.info}>
          Пресет по умолчанию и дополнительный мета-промпт для экрана «Простой режим»: одна кнопка улучшает вставленный текст.
          Подробнее — в <Link to="/help">справке</Link>.
        </p>
        <div className={styles.row}>
          <label className={styles.fieldLabel}>
            Пресет по умолчанию
            <SelectDropdown
              value={simplePreset}
              options={SIMPLE_PRESET_FORM_OPTIONS}
              onChange={(v) => setSimplePreset(v as SimplePresetId)}
              aria-label="Пресет простого режима"
              variant="field"
            />
          </label>
        </div>
        <label className={styles.fieldLabel}>
          Дополнительный мета-промпт (необязательно)
          <textarea
            className={styles.textarea}
            value={simpleMeta}
            onChange={(e) => setSimpleMeta(e.target.value)}
            rows={5}
            placeholder="Например: всегда добавляй критерии успеха; формат — маркированный список."
          />
        </label>
        <div className={styles.row}>
          <button
            type="button"
            onClick={handleSaveSimpleImprove}
            disabled={saving || loading}
            className={styles.btn}
          >
            {saving ? 'Сохранение…' : 'Сохранить простой режим'}
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <h2>Оформление</h2>
        <p className={styles.info}>
          Выбор цветовой палитры и шрифта. Переключение светлой/тёмной темы — в меню профиля (три полоски).
        </p>
        <div className={styles.row}>
          <label className={styles.fieldLabel}>
            Палитра
            <SelectDropdown
              value={palette}
              options={PALETTES.map((item) => ({ value: item, label: PALETTE_LABELS[item] || item }))}
              onChange={(v) => setPalette(v as (typeof PALETTES)[number])}
              aria-label="Цветовая палитра"
              variant="field"
            />
          </label>
          <label className={styles.fieldLabel}>
            Шрифт
            <SelectDropdown
              value={font}
              options={FONTS.map((item) => ({ value: item, label: FONT_LABELS[item] || item }))}
              onChange={(v) => setFont(v as (typeof FONTS)[number])}
              aria-label="Шрифт"
              variant="field"
            />
          </label>
        </div>
      </section>

      <section className={styles.section}>
        <h2>Набор моделей пользователя</h2>
        <p className={styles.info}>
          Выбранные модели используются в Home и Compare как доступные варианты генерации.
        </p>
        <p className={styles.masked}>
          Для генерации: <strong>{settings?.preferred_generation_models?.length ?? 0}</strong> моделей
        </p>
        <Link to="/models" className={styles.btn}>Открыть каталог моделей</Link>
      </section>
    </div>
  )
}
