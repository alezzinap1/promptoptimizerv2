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
  { value: 'heuristic', label: 'Эвристика' },
  { value: 'llm', label: 'LLM' },
] as const

const SIMPLE_PRESET_FORM_OPTIONS = SIMPLE_PRESET_IDS.map((id) => ({
  value: id,
  label: SIMPLE_PRESET_LABELS[id],
}))

const HINT_OPENROUTER =
  'Персональный ключ OpenRouter. Без ключа — пробный режим (лимит токенов). Ключ на сервере, привязан к аккаунту.'

const HINT_CLASSIFICATION =
  'Эвристика — без отдельного запроса. LLM — короткий вызов (токены); в trial дорогая модель может быть заменена.'

const HINT_SIMPLE = 'Пресет и мета-инструкции для «Улучшить». Подробнее — в справке.'

const HINT_APPEARANCE = 'Палитра — оттенки UI. Светлая/тёмная тема — в меню профиля (☰).'

const HINT_MODELS = 'Список моделей в выпадающих списках на главной и в сравнении.'

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
      setMessage({ type: 'ok', text: 'Простой режим: сохранено' })
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
      setMessage({ type: 'ok', text: 'Классификация: сохранена' })
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
      setMessage({ type: 'ok', text: 'Ключ очищен' })
    } catch (e) {
      setMessage({ type: 'err', text: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.shell}>
      <header className={styles.pageHead}>
        <h1 className={`pageTitleGradient ${styles.title}`}>Настройки</h1>
        <p className={styles.lead}>
          Ключ API, классификация, простой режим, оформление и модели — компактно на одном экране.
        </p>
      </header>

      {message && (
        <div className={message.type === 'ok' ? styles.bannerOk : styles.bannerErr} role="status">
          {message.text}
        </div>
      )}

      <div className={styles.grid}>
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>OpenRouter</h2>
          <LabelWithHint label="API ключ" hint={HINT_OPENROUTER}>
            {settings?.openrouter_api_key_set && (
              <p className={styles.metaLine}>
                Сейчас: <code>{settings.openrouter_api_key_masked}</code>
              </p>
            )}
            {loading && <p className={styles.metaLine}>Загрузка…</p>}
            <div className={styles.inlineActions}>
              <input
                type="password"
                placeholder="sk-or-v1-…"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className={styles.input}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={handleSaveApiKey}
                disabled={saving || !apiKey.trim()}
                className={`${styles.btnPrimary} btn-primary`}
              >
                Сохранить
              </button>
              <button
                type="button"
                onClick={handleClearApiKey}
                disabled={saving || !settings?.openrouter_api_key_set}
                className="btn-ghost"
              >
                Очистить
              </button>
            </div>
          </LabelWithHint>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Классификация</h2>
          <p className={styles.cardLead}>Тип задачи на главной перед генерацией.</p>
          <LabelWithHint label="Режим" hint={HINT_CLASSIFICATION}>
            <SelectDropdown
              value={clsMode}
              options={[...CLS_MODE_OPTIONS]}
              onChange={(v) => setClsMode(v as 'heuristic' | 'llm')}
              aria-label="Режим классификации"
              variant="field"
            />
          </LabelWithHint>
          <label className={styles.fieldStack}>
            <span className={styles.labelText}>Модель для LLM</span>
            <input
              className={styles.input}
              value={clsModel}
              onChange={(e) => setClsModel(e.target.value)}
              placeholder="google/gemini-flash-1.5"
              disabled={clsMode !== 'llm'}
            />
          </label>
          <button
            type="button"
            onClick={handleSaveClassification}
            disabled={saving || loading}
            className={`${styles.btnPrimary} btn-primary`}
          >
            Сохранить
          </button>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Простой режим</h2>
          <LabelWithHint label="Пресет и мета-промпт" hint={HINT_SIMPLE}>
            <div className={styles.fieldStack}>
              <span className={styles.labelText}>Пресет</span>
              <SelectDropdown
                value={simplePreset}
                options={SIMPLE_PRESET_FORM_OPTIONS}
                onChange={(v) => setSimplePreset(v as SimplePresetId)}
                aria-label="Пресет простого режима"
                variant="field"
              />
            </div>
            <label className={styles.fieldStack}>
              <span className={styles.labelText}>Доп. инструкции</span>
              <textarea
                className={styles.textarea}
                value={simpleMeta}
                onChange={(e) => setSimpleMeta(e.target.value)}
                rows={3}
                placeholder="Например: всегда добавляй критерии успеха."
              />
            </label>
            <button
              type="button"
              onClick={handleSaveSimpleImprove}
              disabled={saving || loading}
              className={`${styles.btnPrimary} btn-primary`}
            >
              Сохранить
            </button>
            <Link to="/help" className={styles.inlineLink}>
              Справка →
            </Link>
          </LabelWithHint>
        </section>

        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Оформление</h2>
          <LabelWithHint label="Палитра и шрифт" hint={HINT_APPEARANCE}>
            <div className={styles.paletteRow} role="group" aria-label="Палитра">
              {PALETTES.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`${styles.paletteChip} ${palette === id ? styles.paletteChipOn : ''}`}
                  onClick={() => setPalette(id)}
                  aria-pressed={palette === id}
                  title={PALETTE_LABELS[id]}
                >
                  <span className={styles.paletteDot} data-palette-swatch={id} aria-hidden />
                  <span className={styles.paletteChipLabel}>{PALETTE_LABELS[id]}</span>
                </button>
              ))}
            </div>
            <div className={styles.fieldStack}>
              <span className={styles.labelText}>Шрифт UI</span>
              <SelectDropdown
                value={font}
                options={FONTS.map((item) => ({ value: item, label: FONT_LABELS[item] || item }))}
                onChange={(v) => setFont(v as (typeof FONTS)[number])}
                aria-label="Шрифт интерфейса"
                variant="field"
              />
            </div>
            <p className={styles.mutedTiny}>Моноширинный шрифт блоков промпта не меняется.</p>
          </LabelWithHint>
        </section>

        <section className={`${styles.card} ${styles.cardWide}`}>
          <h2 className={styles.cardTitle}>Модели в списках</h2>
          <LabelWithHint label="Каталог OpenRouter" hint={HINT_MODELS}>
            <p className={styles.metaLine}>
              В избранном для генерации: <strong>{settings?.preferred_generation_models?.length ?? 0}</strong>
              {' · '}
              целевых: <strong>{settings?.preferred_target_models?.length ?? 0}</strong>
            </p>
            <Link to="/models" className={`${styles.btnSecondary} btn-secondary`}>
              Открыть каталог моделей
            </Link>
          </LabelWithHint>
        </section>
      </div>
    </div>
  )
}
