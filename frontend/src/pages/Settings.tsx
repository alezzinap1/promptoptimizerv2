import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api, type Settings } from '../api/client'
import {
  SIMPLE_PRESET_IDS,
  SIMPLE_PRESET_LABELS,
  type SimplePresetId,
} from '../constants/simpleImprove'
import { FONTS, PALETTES, useTheme, type PaletteId } from '../context/ThemeContext'
import SelectDropdown from '../components/SelectDropdown'
import LabelWithHint from '../components/LabelWithHint'
import styles from './Settings.module.css'

const PALETTE_LABELS: Record<PaletteId, string> = {
  amber: 'Янтарь',
  obsidian: 'Обсидиан',
  aurora: 'Аврора',
  dune: 'Дюна',
}

const FONT_LABELS: Record<string, string> = {
  plusjakarta: 'Plus Jakarta Sans',
  inter: 'Inter',
  dmsans: 'DM Sans',
  geist: 'Geist',
}

const CLS_MODE_OPTIONS = [
  { value: 'heuristic', label: 'Эвристика (ключевые слова)' },
  { value: 'llm', label: 'LLM-классификатор' },
] as const

const SIMPLE_PRESET_FORM_OPTIONS = SIMPLE_PRESET_IDS.map((id) => ({
  value: id,
  label: SIMPLE_PRESET_LABELS[id],
}))

const HINT_OPENROUTER =
  'Персональный ключ OpenRouter. Без ключа доступен пробный режим с лимитом токенов и дешёвыми моделями. Ключ хранится на сервере, привязан к аккаунту.'

const HINT_CLASSIFICATION =
  'Эвристика — быстро и без отдельного запроса к LLM; точность ограничена. LLM-классификатор — отдельный короткий вызов модели (токены; в пробном режиме слишком дорогая модель может быть заменена на доступную по умолчанию).'

const HINT_SIMPLE =
  'Пресет и дополнительные инструкции для экрана «Простой режим». Подробнее в разделе Справка → Простой режим.'

const HINT_APPEARANCE =
  'Палитра задаёт оттенки интерфейса. Светлая/тёмная тема переключается в меню профиля (иконка ☰). Шрифт применяется ко всему интерфейсу; моноширинный шрифт промптов не меняется.'

const HINT_MODELS =
  'Список моделей для выпадающих списков на главной и в сравнении. Управление — в каталоге моделей.'

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
    api
      .getSettings()
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
      setMessage({ type: 'ok', text: 'Настройки классификации сохранены' })
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
      {message && (
        <p className={message.type === 'ok' ? styles.msgOk : styles.msgErr}>{message.text}</p>
      )}

      <section className={styles.section}>
        <LabelWithHint label={<>OpenRouter API</>} hint={HINT_OPENROUTER}>
          <p className={styles.fieldHint}>Без ключа — пробный режим. Ключ хранится на сервере.</p>
        </LabelWithHint>
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
            type="button"
            onClick={handleSaveApiKey}
            disabled={saving || !apiKey.trim()}
            className={`${styles.btn} btn-primary`}
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
          <button
            type="button"
            onClick={handleClearApiKey}
            disabled={saving || !settings?.openrouter_api_key_set}
            className={`${styles.btn} btn-danger`}
          >
            Очистить
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <h2>Классификация задач</h2>
        <p className={styles.sectionLead}>Влияет на главный экран.</p>
        <LabelWithHint label="Режим" hint={HINT_CLASSIFICATION}>
          <SelectDropdown
            value={clsMode}
            options={[...CLS_MODE_OPTIONS]}
            onChange={(v) => setClsMode(v as 'heuristic' | 'llm')}
            aria-label="Режим классификации"
            variant="field"
          />
        </LabelWithHint>
        <label className={styles.fieldLabel}>
          Модель для LLM-режима
          <input
            className={styles.input}
            value={clsModel}
            onChange={(e) => setClsModel(e.target.value)}
            placeholder="google/gemini-flash-1.5"
            disabled={clsMode !== 'llm'}
          />
        </label>
        <p className={styles.fieldHint}>Пусто — значение по умолчанию на сервере.</p>
        <div className={styles.row}>
          <button
            type="button"
            onClick={handleSaveClassification}
            disabled={saving || loading}
            className={`${styles.btn} btn-primary`}
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <LabelWithHint label={<>Простой режим</>} hint={HINT_SIMPLE}>
          <p className={styles.fieldHint}>Пресет и мета-инструкции для экрана «Простой режим». Подробнее — в{' '}
            <Link to="/help">справке</Link>.</p>
        </LabelWithHint>
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
            className={`${styles.btn} btn-primary`}
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <LabelWithHint label={<>Оформление</>} hint={HINT_APPEARANCE}>
          <p className={styles.fieldHint}>Тёмная/светлая тема — в меню профиля (☰).</p>
        </LabelWithHint>
        <p className={styles.fieldLabel}>Палитра</p>
        <div className={styles.paletteGrid} role="group" aria-label="Цветовая палитра">
          {PALETTES.map((id) => (
            <button
              key={id}
              type="button"
              className={`${styles.paletteCard} ${palette === id ? styles.paletteCardActive : ''}`}
              onClick={() => setPalette(id)}
              aria-pressed={palette === id}
            >
              <span className={styles.paletteSwatch} data-palette-swatch={id} aria-hidden />
              <span className={styles.paletteName}>{PALETTE_LABELS[id]}</span>
            </button>
          ))}
        </div>
        <label className={styles.fieldLabel}>
          Шрифт интерфейса
          <SelectDropdown
            value={font}
            options={FONTS.map((item) => ({ value: item, label: FONT_LABELS[item] || item }))}
            onChange={(v) => setFont(v as (typeof FONTS)[number])}
            aria-label="Шрифт интерфейса"
            variant="field"
          />
        </label>
        <p className={styles.fieldHint}>Моноширинный шрифт блоков с промптом не меняется.</p>
      </section>

      <section className={styles.section}>
        <LabelWithHint label={<>Набор моделей</>} hint={HINT_MODELS}>
          <p className={styles.fieldHint}>Модели для главной и сравнения.</p>
        </LabelWithHint>
        <p className={styles.masked}>
          Для генерации: <strong>{settings?.preferred_generation_models?.length ?? 0}</strong> моделей
        </p>
        <Link to="/models" className={`${styles.btn} btn-secondary`}>
          Открыть каталог моделей
        </Link>
      </section>
    </div>
  )
}
