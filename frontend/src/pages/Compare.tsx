import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api, type CompareJudgeResponse, type CompareResponse, type OpenRouterModel } from '../api/client'
import AutoTextarea from '../components/AutoTextarea'
import MarkdownOutput from '../components/MarkdownOutput'
import SelectDropdown from '../components/SelectDropdown'
import { CopyIconButton } from '../components/PromptToolbarIcons'
import checkboxList from '../styles/CheckboxOptionList.module.css'
import cb from '../styles/ComposerBar.module.css'
import { shortGenerationModelLabel } from '../utils/generationModelLabel'
import styles from './Compare.module.css'
import pageStyles from '../styles/PageShell.module.css'

export default function Compare() {
  const location = useLocation()
  const [taskInput, setTaskInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CompareResponse | null>(null)
  const [judgeModel, setJudgeModel] = useState('')
  const [judgeLoading, setJudgeLoading] = useState(false)
  const [judgeResult, setJudgeResult] = useState<CompareJudgeResponse | null>(null)
  const [judgeError, setJudgeError] = useState<string | null>(null)
  const [genModel, setGenModel] = useState('')
  const [modelsMap, setModelsMap] = useState<Record<string, string>>({ unknown: 'Неизвестно / Любая модель' })
  const [techniques, setTechniques] = useState<{ id: string; name: string }[]>([])
  const [generationOptions, setGenerationOptions] = useState<string[]>([])
  const [techsAMode, setTechsAMode] = useState<'auto' | 'manual'>('auto')
  const [techsBMode, setTechsBMode] = useState<'auto' | 'manual'>('auto')
  const [techsAManual, setTechsAManual] = useState<string[]>([])
  const [techsBManual, setTechsBManual] = useState<string[]>([])
  const [temperature, setTemperature] = useState(0.7)
  const [topP, setTopP] = useState(1)
  const [showCompareAdv, setShowCompareAdv] = useState(false)

  useEffect(() => {
    const state = location.state as { taskInput?: string } | null
    if (state?.taskInput) setTaskInput(state.taskInput)
    Promise.all([api.getSettings(), api.getModels(), api.getTechniques()]).then(([settings, modelRes, techniquesRes]) => {
      const labels = modelRes.data.reduce<Record<string, string>>((acc, item: OpenRouterModel) => {
        acc[item.id] = item.name || item.id
        return acc
      }, { unknown: 'Неизвестно / Любая модель' })
      setModelsMap(labels)
      setGenerationOptions(settings.preferred_generation_models)
      const gen0 = settings.preferred_generation_models[0] || ''
      setGenModel(gen0)
      setJudgeModel(gen0 || 'gemini_flash')
      setTechniques(techniquesRes.techniques.map((item) => ({
        id: String(item.id),
        name: String(item.name || item.id),
      })))
    }).catch((e) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'))
  }, [location.state])

  const genModelSelectOptions = useMemo(
    () =>
      generationOptions.map((id) => {
        const full = modelsMap[id] || id
        return { value: id, label: shortGenerationModelLabel(full), title: full }
      }),
    [generationOptions, modelsMap],
  )

  const techById = useMemo(() => Object.fromEntries(techniques.map((t) => [t.id, t.name])), [techniques])

  const renderTechBadges = (mode: 'auto' | 'manual', manualIds: string[]) => {
    if (mode === 'auto') {
      return (
        <span className={styles.chipAuto} title="Техники подбираются автоматически по типу задачи">
          Авто-подбор
        </span>
      )
    }
    if (manualIds.length === 0) {
      return <span className={styles.chipWarn}>Выберите техники вручную</span>
    }
    return manualIds.map((id) => (
      <span key={id} className={styles.chipTech} title={techById[id] || id}>
        {techById[id] || id}
      </span>
    ))
  }

  const handleCompare = async () => {
    if (!taskInput.trim()) return
    setLoading(true)
    setError(null)
    setJudgeResult(null)
    setJudgeError(null)
    try {
      const res = await api.compare({
        task_input: taskInput.trim(),
        gen_model: genModel,
        target_model: 'unknown',
        temperature,
        top_p: topP,
        techs_a_mode: techsAMode,
        techs_a_manual: techsAManual,
        techs_b_mode: techsBMode,
        techs_b_manual: techsBManual,
      })
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  const handleJudge = async () => {
    if (!result || !taskInput.trim()) return
    setJudgeLoading(true)
    setJudgeError(null)
    try {
      const j = await api.compareJudge({
        task_input: taskInput.trim(),
        prompt_a: result.a.prompt,
        prompt_b: result.b.prompt,
        judge_model: judgeModel.trim() || undefined,
      })
      setJudgeResult(j)
    } catch (e) {
      setJudgeError(e instanceof Error ? e.message : 'Ошибка судьи')
    } finally {
      setJudgeLoading(false)
    }
  }

  return (
    <div className={`${pageStyles.page} ${styles.compare}`}>
      <div className={pageStyles.panelHeader}>
        <div>
          <h1 className="pageTitleGradient">A/B Сравнение техник</h1>
          <p className={pageStyles.panelSubtitle}>Сгенерируй один промпт двумя разными наборами техник и сравни результат</p>
        </div>
        {loading && <span className={pageStyles.infoBadge}>Генерирую...</span>}
      </div>

      <div className={styles.taskComposerBlock}>
        <div className={styles.fieldLabelRow}>
          <label>Задача (одна для обоих вариантов)</label>
          {taskInput.trim() ? <CopyIconButton text={taskInput} title="Копировать задачу" /> : null}
        </div>
        <div className={cb.composer}>
          <AutoTextarea
            className={cb.composerTextarea}
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            placeholder="Нужен промпт для извлечения ключевых метрик из финансового отчёта..."
            minHeightPx={80}
            maxHeightPx={400}
            spellCheck
          />
          <div className={cb.composerFooter}>
            <div className={cb.composerFooterRow}>
              <div className={cb.composerFooterMid} style={{ flex: 1 }}>
                <SelectDropdown
                  value={genModel}
                  options={genModelSelectOptions}
                  onChange={setGenModel}
                  aria-label="Модель генерации"
                  variant="composer"
                  footerLink={{ to: '/models', label: 'Добавить модель' }}
                />
                <button
                  type="button"
                  className={`${cb.composerGhostBtn} btn-ghost`}
                  onClick={() => setShowCompareAdv((v) => !v)}
                >
                  {showCompareAdv ? 'Меньше' : 'Т° / Top-P'}
                </button>
              </div>
            </div>
          </div>
          {showCompareAdv && (
            <div className={cb.composerInset}>
              <div className={styles.compareAdvRow}>
                <label className={styles.compareAdvField}>
                  Температура {temperature}
                  <input type="range" min={0.1} max={1} step={0.1} value={temperature} onChange={(e) => setTemperature(parseFloat(e.target.value))} />
                </label>
                <label className={styles.compareAdvField}>
                  Top-P {topP.toFixed(2)}
                  <input type="range" min={0} max={1} step={0.05} value={topP} onChange={(e) => setTopP(parseFloat(e.target.value))} />
                </label>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className={styles.generateRow}>
        <button
          type="button"
          className={`${styles.generateBothBtn} btn-primary`}
          onClick={handleCompare}
          disabled={!taskInput.trim() || loading}
        >
          {loading ? 'Генерирую…' : 'Сгенерировать оба'}
        </button>
      </div>

      <p className={styles.modeExplainer}>
        <strong>Авто</strong> — техники подбираются по типу задачи. <strong>Вручную</strong> — только отмеченные ниже техники
        попадут в промпт. После генерации в каждом столбце появится текст промпта и метрики — так видна разница A и B.
      </p>

      <div className={styles.results}>
        <div className={`${styles.column} ${styles.columnVariantA}`}>
          <h3 className={styles.columnTitleA}>Вариант A</h3>
          <div className={styles.badgeRow} aria-label="Техники варианта A">
            {renderTechBadges(techsAMode, techsAManual)}
          </div>
          <div className={styles.previewZone}>
            <div className={styles.previewTitle}>Что будет в этом столбце</div>
            <ol className={styles.previewSteps}>
              <li>
                <strong>Техники</strong> — как на бейджах выше.
              </li>
              <li>
                <strong>Промпт</strong> — текст инструкции для модели (появится после генерации ниже на странице).
              </li>
              <li>
                <strong>Сравнение</strong> — метрики и при необходимости LLM-судья подскажут, какой вариант сильнее.
              </li>
            </ol>
          </div>
          <div className={`${styles.radioRow} ${styles.radioRowA}`}>
            <label title="Техники выберет модель по классификации задачи">
              <input type="radio" checked={techsAMode === 'auto'} onChange={() => setTechsAMode('auto')} /> Авто
            </label>
            <label title="Использовать только отмеченные ниже техники">
              <input type="radio" checked={techsAMode === 'manual'} onChange={() => setTechsAMode('manual')} /> Вручную
            </label>
          </div>
          {techsAMode === 'manual' && (
            <div className={checkboxList.gridWrap} role="group" aria-label="Техники варианта A">
              {techniques.map((t) => (
                <label key={t.id} className={checkboxList.optionCheck}>
                  <input
                    type="checkbox"
                    checked={techsAManual.includes(t.id)}
                    onChange={() => {
                      setTechsAManual((prev) =>
                        prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id],
                      )
                    }}
                  />
                  <span>{t.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className={`${styles.column} ${styles.columnVariantB}`}>
          <h3 className={styles.columnTitleB}>Вариант B</h3>
          <div className={styles.badgeRow} aria-label="Техники варианта B">
            {renderTechBadges(techsBMode, techsBManual)}
          </div>
          <div className={styles.previewZone}>
            <div className={styles.previewTitle}>Что будет в этом столбце</div>
            <ol className={styles.previewSteps}>
              <li>
                <strong>Техники</strong> — как на бейджах выше.
              </li>
              <li>
                <strong>Промпт</strong> — отдельная сборка инструкции (сравните текст с колонкой A).
              </li>
              <li>
                <strong>Сравнение</strong> — те же метрики, другой набор техник → другая полнота и длина.
              </li>
            </ol>
          </div>
          <div className={`${styles.radioRow} ${styles.radioRowB}`}>
            <label title="Техники выберет модель по классификации задачи">
              <input type="radio" checked={techsBMode === 'auto'} onChange={() => setTechsBMode('auto')} /> Авто
            </label>
            <label title="Использовать только отмеченные ниже техники">
              <input type="radio" checked={techsBMode === 'manual'} onChange={() => setTechsBMode('manual')} /> Вручную
            </label>
          </div>
          {techsBMode === 'manual' && (
            <div className={checkboxList.gridWrap} role="group" aria-label="Техники варианта B">
              {techniques.map((t) => (
                <label key={t.id} className={checkboxList.optionCheck}>
                  <input
                    type="checkbox"
                    checked={techsBManual.includes(t.id)}
                    onChange={() => {
                      setTechsBManual((prev) =>
                        prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id],
                      )
                    }}
                  />
                  <span>{t.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {result && (
        <>
          {result.winner_heuristic_note && (
            <p className={styles.heuristicNote}>{result.winner_heuristic_note}</p>
          )}
          <div className={styles.winner}>
            {result.winner === 'tie' ? 'Варианты равны по внутренним метрикам' : `По внутренним метрикам лидирует ${result.winner.toUpperCase()}`}
          </div>
          <div className={styles.judgeRow}>
            <label className={styles.judgeLabel}>
              Модель-судья (id OpenRouter или короткий ключ)
              <input
                type="text"
                className={styles.judgeInput}
                list="compare-judge-models"
                value={judgeModel}
                onChange={(e) => setJudgeModel(e.target.value)}
                placeholder="напр. gemini_flash или google/gemini-flash-1.5"
              />
              <datalist id="compare-judge-models">
                {generationOptions.map((id) => (
                  <option key={id} value={id} label={modelsMap[id] || id} />
                ))}
              </datalist>
            </label>
            <button type="button" className={`${styles.secondaryBtn} btn-secondary`} onClick={handleJudge} disabled={judgeLoading}>
              {judgeLoading ? 'Судья…' : 'LLM-судья'}
            </button>
          </div>
          {judgeError && <p className={styles.error}>{judgeError}</p>}
          {judgeResult && (
            <div className={styles.judgeBox}>
              <strong>Вердикт судьи:</strong>{' '}
              {judgeResult.winner === 'tie' ? 'ничья' : judgeResult.winner.toUpperCase()}
              {judgeResult.scores && (
                <span className={styles.judgeScores}> · оценки: {JSON.stringify(judgeResult.scores)}</span>
              )}
              <div className={styles.judgeReasonMd}>
                <MarkdownOutput>{judgeResult.reasoning}</MarkdownOutput>
              </div>
            </div>
          )}
          <div className={styles.metricCompare}>
            <div>Полнота A: {String(result.a.metrics.completeness_score ?? result.a.metrics.quality_score ?? 0)}%</div>
            <div>Полнота B: {String(result.b.metrics.completeness_score ?? result.b.metrics.quality_score ?? 0)}%</div>
            <div>Токены A: {String(result.a.metrics.token_estimate ?? 0)}</div>
            <div>Токены B: {String(result.b.metrics.token_estimate ?? 0)}</div>
          </div>
          <div className={styles.results}>
          <div className={`${styles.column} ${styles.columnVariantA}`}>
            <h3 className={styles.columnTitleA}>Вариант A — результат</h3>
            <p className={styles.meta}>{result.a.techniques.map((t) => t.name).join(' + ')}</p>
            {result.a.reasoning && (
              <details>
                <summary>Пояснение A</summary>
                <div className={styles.copyRow}>
                  <CopyIconButton text={result.a.reasoning} title="Копировать пояснение A" />
                </div>
                <div className={styles.promptMarkdownWrap}>
                  <MarkdownOutput>{result.a.reasoning}</MarkdownOutput>
                </div>
              </details>
            )}
            <div className={styles.copyRow}>
              <CopyIconButton text={result.a.prompt} title="Копировать промпт A" />
            </div>
            <div className={styles.promptMarkdownWrap}>
              <MarkdownOutput>{result.a.prompt}</MarkdownOutput>
            </div>
            <button type="button" className="btn-secondary" onClick={() => {
              const blob = new Blob([result.a.prompt], { type: 'text/plain;charset=utf-8' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = 'prompt_a.txt'
              a.click()
              URL.revokeObjectURL(url)
            }}>Скачать A (.txt)</button>
          </div>
          <div className={`${styles.column} ${styles.columnVariantB}`}>
            <h3 className={styles.columnTitleB}>Вариант B — результат</h3>
            <p className={styles.meta}>{result.b.techniques.map((t) => t.name).join(' + ')}</p>
            {result.b.reasoning && (
              <details>
                <summary>Пояснение B</summary>
                <div className={styles.copyRow}>
                  <CopyIconButton text={result.b.reasoning} title="Копировать пояснение B" />
                </div>
                <div className={styles.promptMarkdownWrap}>
                  <MarkdownOutput>{result.b.reasoning}</MarkdownOutput>
                </div>
              </details>
            )}
            <div className={styles.copyRow}>
              <CopyIconButton text={result.b.prompt} title="Копировать промпт B" />
            </div>
            <div className={styles.promptMarkdownWrap}>
              <MarkdownOutput>{result.b.prompt}</MarkdownOutput>
            </div>
            <button type="button" className="btn-secondary" onClick={() => {
              const blob = new Blob([result.b.prompt], { type: 'text/plain;charset=utf-8' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = 'prompt_b.txt'
              a.click()
              URL.revokeObjectURL(url)
            }}>Скачать B (.txt)</button>
          </div>
          </div>
        </>
      )}
    </div>
  )
}
