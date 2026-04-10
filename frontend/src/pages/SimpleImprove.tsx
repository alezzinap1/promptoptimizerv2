import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type OpenRouterModel } from '../api/client'
import {
  SIMPLE_PRESET_IDS,
  SIMPLE_PRESET_LABELS,
  type SimplePresetId,
} from '../constants/simpleImprove'
import AutoTextarea from '../components/AutoTextarea'
import MarkdownOutput from '../components/MarkdownOutput'
import SelectDropdown from '../components/SelectDropdown'
import { CopyIconButton } from '../components/PromptToolbarIcons'
import { TryExternalChatButton } from '../components/TryExternalChatButton'
import SimpleLineDiff from '../components/SimpleLineDiff'
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
  const [targetModel, setTargetModel] = useState('unknown')
  const [models, setModels] = useState<string[]>([])
  const [preferredTargets, setPreferredTargets] = useState<string[]>(['unknown'])
  const [modelLabels, setModelLabels] = useState<Record<string, string>>({ unknown: 'Неизвестно / Любая модель' })
  const [result, setResult] = useState('')
  const [metaHint, setMetaHint] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    Promise.all([api.getSettings(), api.getModels()])
      .then(([s, modelsRes]) => {
        const list = s.preferred_generation_models || []
        setModels(list)
        setGenModel((prev) => prev || list[0] || '')
        const labels = modelsRes.data.reduce<Record<string, string>>((acc, item: OpenRouterModel) => {
          acc[item.id] = item.name || item.id
          return acc
        }, { unknown: 'Неизвестно / Любая модель' })
        setModelLabels(labels)
        const targets = s.preferred_target_models?.length ? s.preferred_target_models : ['unknown']
        setPreferredTargets(targets)
        setTargetModel((prev) => (targets.includes(prev) ? prev : targets[0]))
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

  const targetOptions = useMemo(
    () =>
      preferredTargets.map((id) => ({
        value: id,
        label: modelLabels[id] || shortGenerationModelLabel(id),
        title: id,
      })),
    [preferredTargets, modelLabels],
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
        target_model: targetModel.trim() || undefined,
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
          <h1 className="pageTitleGradient">Улучшить</h1>
          <p className={styles.lead}>
            Быстрое улучшение текста промпта по пресету. Полный цикл — на <Link to="/home">Студии</Link>.{' '}
            <Link to="/help">Справка</Link> · <Link to="/settings">Настройки</Link>
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
                  <span className={cb.metaMuted}>Пресет, генерация, целевая</span>
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
                    aria-label="Модель генерации"
                    variant="composer"
                    footerLink={{ to: '/models', label: 'Добавить модель' }}
                  />
                  <SelectDropdown
                    value={targetModel}
                    options={targetOptions}
                    onChange={setTargetModel}
                    aria-label="Целевая модель промпта"
                    variant="composer"
                    footerLink={{ to: '/settings', label: 'Настроить список' }}
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
            {result ? (
              <div className={styles.colHeadActions}>
                <CopyIconButton text={result} title="Копировать результат" />
                <TryExternalChatButton prompt={result} title="Скопировать результат и открыть чат ИИ" />
              </div>
            ) : null}
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
          {result && promptText.trim() ? (
            <details className={styles.diffDetails}>
              <summary>Построчное сравнение с исходным</summary>
              <p className={styles.diffHint}>
                Зелёным — добавленные или изменённые строки, красным — удалённые. Без изменений — нейтральный цвет.
              </p>
              <SimpleLineDiff before={promptText} after={result} />
            </details>
          ) : null}
        </div>
      </div>

      {error && <p className={styles.error}>{error}</p>}
    </div>
  )
}
