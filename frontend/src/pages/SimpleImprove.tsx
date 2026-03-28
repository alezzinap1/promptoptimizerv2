import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import {
  SIMPLE_PRESET_IDS,
  SIMPLE_PRESET_LABELS,
  type SimplePresetId,
} from '../constants/simpleImprove'
import AutoTextarea from '../components/AutoTextarea'
import MarkdownOutput from '../components/MarkdownOutput'
import SelectDropdown from '../components/SelectDropdown'
import { CopyIconButton } from '../components/PromptToolbarIcons'
import cb from '../styles/ComposerBar.module.css'
import { shortGenerationModelLabel } from '../utils/generationModelLabel'
import styles from './SimpleImprove.module.css'

const PRESET_SELECT_OPTIONS = SIMPLE_PRESET_IDS.map((id) => ({
  value: id,
  label: SIMPLE_PRESET_LABELS[id],
}))

export default function SimpleImprove() {
  const [promptText, setPromptText] = useState('')
  const [preset, setPreset] = useState<SimplePresetId>('balanced')
  const [genModel, setGenModel] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [result, setResult] = useState('')
  const [metaHint, setMetaHint] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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

  const modelOptions = useMemo(
    () => models.map((m) => ({ value: m, label: shortGenerationModelLabel(m), title: m })),
    [models],
  )

  const run = async () => {
    const t = promptText.trim()
    if (!t) {
      setError('Вставьте текст промпта.')
      return
    }
    setLoading(true)
    setError(null)
    setResult('')
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

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div>
          <h1 className="pageTitleGradient">Простой режим</h1>
          <p className={styles.lead}>
            Вставьте промпт и нажмите кнопку — получите улучшенный текст.{' '}
            <Link to="/help">Справка</Link>
            {' · '}
            <Link to="/settings">Настройки пресета и мета-промпта</Link>
          </p>
        </div>
      </header>

      {metaHint && <p className={styles.hint}>{metaHint}</p>}

      <div className={styles.pairGrid}>
        <div className={styles.col}>
          <div className={styles.colHead}>
            <div>
              <h2 className={styles.colTitle}>Запрос</h2>
              <p className={styles.colHint}>Исходный текст промпта</p>
            </div>
            {promptText.trim() ? <CopyIconButton text={promptText} title="Копировать исходный промпт" /> : null}
          </div>
          <div className={cb.composer}>
            <AutoTextarea
              className={cb.composerTextarea}
              placeholder="Ваш промпт…"
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              minHeightPx={72}
              maxHeightPx={400}
              spellCheck
            />
            <div className={cb.composerFooter}>
              <div className={cb.composerFooterRow}>
                <div className={cb.composerFooterStart}>
                  <span className={cb.metaMuted}>Пресет и модель</span>
                </div>
                <div className={cb.composerFooterMid}>
                  <SelectDropdown
                    value={preset}
                    options={PRESET_SELECT_OPTIONS}
                    onChange={(v) => setPreset(v as SimplePresetId)}
                    aria-label="Пресет"
                    variant="composer"
                  />
                  <SelectDropdown
                    value={genModel}
                    options={modelOptions}
                    onChange={setGenModel}
                    aria-label="Модель"
                    variant="composer"
                    footerLink={{ to: '/models', label: 'Добавить модель' }}
                  />
                </div>
                <div className={cb.composerFooterEnd}>
                  <button type="button" className={cb.composerPrimary} onClick={run} disabled={loading}>
                    {loading ? 'Улучшаем…' : 'Улучшить промпт'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className={styles.col}>
          <div className={styles.colHead}>
            <div>
              <h2 className={styles.colTitle}>Ответ</h2>
              <p className={styles.colHint}>Улучшенный вариант от модели</p>
            </div>
            {result ? <CopyIconButton text={result} title="Копировать результат" /> : null}
          </div>
          <div className={styles.answerPanel}>
            {result ? (
              <div className={styles.resultMarkdown}>
                <MarkdownOutput>{result}</MarkdownOutput>
              </div>
            ) : (
              <p className={styles.answerPlaceholder}>
                После нажатия «Улучшить промпт» результат появится здесь.
              </p>
            )}
          </div>
        </div>
      </div>

      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}
