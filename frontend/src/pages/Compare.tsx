import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, type CompareJudgeResponse, type CompareResponse, type OpenRouterModel } from '../api/client'
import AutoTextarea from '../components/AutoTextarea'
import MarkdownOutput from '../components/MarkdownOutput'
import SelectDropdown from '../components/SelectDropdown'
import SimpleLineDiff from '../components/SimpleLineDiff'
import { CopyIconButton } from '../components/PromptToolbarIcons'
import checkboxList from '../styles/CheckboxOptionList.module.css'
import cb from '../styles/ComposerBar.module.css'
import { EXPERT_GENERATION_TEMPERATURE_CAP } from '../lib/expertLevelPresets'
import { shortGenerationModelLabel } from '../utils/generationModelLabel'
import styles from './Compare.module.css'
import pageStyles from '../styles/PageShell.module.css'

/*
 * Compare v2 — three-mode side-by-side workspace.
 *
 * Modes:
 *  - techniques: existing behaviour. One task → /api/compare → two prompts
 *    with different technique sets.
 *  - prompts:    user pastes two prompts directly → run both on a target
 *    model → compare outputs. No generation step.
 *  - models:     placeholder — full support lands in a follow-up pass.
 *
 * After either generation step, a shared results block renders:
 *  prompts panel (with line diff) → optional run-on-target panel (with
 *  output diff) → structured judge card → winner actions.
 *
 * Spec: docs/superpowers/specs/2026-04-16-product-ux-visual-design.md §9.
 */

type Mode = 'techniques' | 'prompts' | 'models'

interface VariantCore {
  prompt: string
  reasoning?: string
  techniques?: { id: string; name: string }[]
  metrics?: Record<string, unknown>
}

interface CompareWorkspace {
  a: VariantCore
  b: VariantCore
  winner: 'a' | 'b' | 'tie'
  winnerNote?: string
  source: Mode
}

interface OutputPair {
  a: string
  b: string
  targetModel: string
  tokensA: number
  tokensB: number
  costUsd: number
}

function scoreOf(metrics: Record<string, unknown> | undefined): number {
  if (!metrics) return 0
  const v = (metrics.completeness_score ?? metrics.quality_score ?? 0) as number
  return Number(v) || 0
}

function tokenEstimate(metrics: Record<string, unknown> | undefined, fallback: string): number {
  if (metrics && typeof metrics.token_estimate === 'number') {
    return metrics.token_estimate as number
  }
  return Math.max(1, Math.round(fallback.length / 4))
}

export default function Compare() {
  const location = useLocation()
  const navigate = useNavigate()

  // Shared
  const [mode, setMode] = useState<Mode>('techniques')
  const [modelsMap, setModelsMap] = useState<Record<string, string>>({ unknown: 'Неизвестно / Любая модель' })
  const [generationOptions, setGenerationOptions] = useState<string[]>([])
  const [preferredTargetModels, setPreferredTargetModels] = useState<string[]>(['unknown'])
  const [techniques, setTechniques] = useState<{ id: string; name: string }[]>([])

  // Techniques mode
  const [taskInput, setTaskInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [genModel, setGenModel] = useState('')
  const [targetModel, setTargetModel] = useState('unknown')
  const [techsAMode, setTechsAMode] = useState<'auto' | 'manual'>('auto')
  const [techsBMode, setTechsBMode] = useState<'auto' | 'manual'>('auto')
  const [techsAManual, setTechsAManual] = useState<string[]>([])
  const [techsBManual, setTechsBManual] = useState<string[]>([])
  const [temperature, setTemperature] = useState(0.7)
  const [topP, setTopP] = useState(1)
  const [showCompareAdv, setShowCompareAdv] = useState(false)

  // Prompts mode
  const [pastedA, setPastedA] = useState('')
  const [pastedB, setPastedB] = useState('')

  // Shared result + outputs + judge
  const [workspace, setWorkspace] = useState<CompareWorkspace | null>(null)
  const [outputs, setOutputs] = useState<OutputPair | null>(null)
  const [runningOutputs, setRunningOutputs] = useState(false)
  const [outputsError, setOutputsError] = useState<string | null>(null)

  const [judgeModel, setJudgeModel] = useState('')
  const [judgeLoading, setJudgeLoading] = useState(false)
  const [judgeResult, setJudgeResult] = useState<CompareJudgeResponse | null>(null)
  const [judgeError, setJudgeError] = useState<string | null>(null)
  const [judgeOn, setJudgeOn] = useState<'prompts' | 'outputs'>('prompts')

  // Bootstrap: settings, models, techniques
  useEffect(() => {
    const state = location.state as { taskInput?: string; promptA?: string; promptB?: string } | null
    if (state?.taskInput) setTaskInput(state.taskInput)
    if (state?.promptA) setPastedA(state.promptA)
    if (state?.promptB) setPastedB(state.promptB)
    Promise.all([api.getSettings(), api.getModels(), api.getTechniques()])
      .then(([settings, modelRes, techniquesRes]) => {
        const labels = modelRes.data.reduce<Record<string, string>>(
          (acc, item: OpenRouterModel) => {
            acc[item.id] = item.name || item.id
            return acc
          },
          { unknown: 'Неизвестно / Любая модель' },
        )
        setModelsMap(labels)
        setGenerationOptions(settings.preferred_generation_models)
        const targets = settings.preferred_target_models?.length
          ? settings.preferred_target_models
          : ['unknown']
        setPreferredTargetModels(targets)
        setTargetModel((prev) => (prev !== 'unknown' && targets.includes(prev) ? prev : targets[0] || 'unknown'))
        const gen0 = settings.preferred_generation_models[0] || ''
        setGenModel(gen0)
        setJudgeModel(gen0 || 'gemini_flash')
        setTechniques(
          techniquesRes.techniques.map((item) => ({
            id: String(item.id),
            name: String(item.name || item.id),
          })),
        )
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'))
  }, [location.state])

  const genModelSelectOptions = useMemo(
    () =>
      generationOptions.map((id) => {
        const full = modelsMap[id] || id
        return { value: id, label: shortGenerationModelLabel(full), title: full }
      }),
    [generationOptions, modelsMap],
  )

  const targetModelSelectOptions = useMemo(
    () =>
      preferredTargetModels.map((id) => ({
        value: id,
        label: id === 'unknown' ? 'Любая модель' : shortGenerationModelLabel(modelsMap[id] || id),
        title: id === 'unknown' ? 'Промпт без привязки к модели' : modelsMap[id] || id,
      })),
    [preferredTargetModels, modelsMap],
  )

  // Concrete targets only (exclude "unknown") — used for run-on-target selector.
  const concreteTargetOptions = useMemo(
    () =>
      targetModelSelectOptions.filter((opt) => opt.value !== 'unknown'),
    [targetModelSelectOptions],
  )

  const techById = useMemo(
    () => Object.fromEntries(techniques.map((t) => [t.id, t.name])),
    [techniques],
  )

  const renderTechBadges = (tmode: 'auto' | 'manual', manualIds: string[]) => {
    if (tmode === 'auto') {
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

  const resetResults = () => {
    setWorkspace(null)
    setOutputs(null)
    setOutputsError(null)
    setJudgeResult(null)
    setJudgeError(null)
  }

  const handleCompareTechniques = async () => {
    if (!taskInput.trim()) return
    setLoading(true)
    setError(null)
    resetResults()
    try {
      const res: CompareResponse = await api.compare({
        task_input: taskInput.trim(),
        gen_model: genModel,
        target_model: targetModel,
        temperature,
        top_p: topP,
        techs_a_mode: techsAMode,
        techs_a_manual: techsAManual,
        techs_b_mode: techsBMode,
        techs_b_manual: techsBManual,
      })
      setWorkspace({
        a: {
          prompt: res.a.prompt,
          reasoning: res.a.reasoning,
          techniques: res.a.techniques,
          metrics: res.a.metrics,
        },
        b: {
          prompt: res.b.prompt,
          reasoning: res.b.reasoning,
          techniques: res.b.techniques,
          metrics: res.b.metrics,
        },
        winner: res.winner,
        winnerNote: res.winner_heuristic_note,
        source: 'techniques',
      })
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Ошибка'
      if (/identical technique sets/i.test(msg)) {
        msg = 'Варианты A и B совпали по набору техник. Смените режим (авто/вручную) для одного из вариантов.'
      }
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const handleUsePrompts = () => {
    const a = pastedA.trim()
    const b = pastedB.trim()
    if (!a || !b) {
      setError('Заполните оба промпта — A и B.')
      return
    }
    if (a === b) {
      setError('Промпты A и B одинаковы — сравнивать нечего.')
      return
    }
    setError(null)
    resetResults()
    setWorkspace({
      a: { prompt: a },
      b: { prompt: b },
      winner: 'tie',
      source: 'prompts',
    })
  }

  const handleRunOnTarget = async () => {
    if (!workspace) return
    if (!targetModel || targetModel === 'unknown') {
      setOutputsError('Выберите конкретную целевую модель, чтобы прогнать на ней оба промпта.')
      return
    }
    setRunningOutputs(true)
    setOutputsError(null)
    try {
      const [aRes, bRes] = await Promise.all([
        api.compareRunOnTarget({
          prompt: workspace.a.prompt,
          target_model: targetModel,
          task_input: mode === 'techniques' ? taskInput : '',
          temperature,
          top_p: topP,
        }),
        api.compareRunOnTarget({
          prompt: workspace.b.prompt,
          target_model: targetModel,
          task_input: mode === 'techniques' ? taskInput : '',
          temperature,
          top_p: topP,
        }),
      ])
      setOutputs({
        a: aRes.output,
        b: bRes.output,
        targetModel,
        tokensA: aRes.tokens_used,
        tokensB: bRes.tokens_used,
        costUsd: aRes.cost_usd + bRes.cost_usd,
      })
      setJudgeOn('outputs')
      setJudgeResult(null)
      setJudgeError(null)
    } catch (e) {
      setOutputsError(e instanceof Error ? e.message : 'Не удалось прогнать на целевой модели.')
    } finally {
      setRunningOutputs(false)
    }
  }

  const handleJudge = async () => {
    if (!workspace) return
    const hasOutputs = !!outputs
    const useOutputs = judgeOn === 'outputs' && hasOutputs
    const promptA = useOutputs ? (outputs as OutputPair).a : workspace.a.prompt
    const promptB = useOutputs ? (outputs as OutputPair).b : workspace.b.prompt
    const taskForJudge =
      mode === 'techniques'
        ? taskInput.trim()
        : useOutputs
          ? 'Сравните два ответа модели по качеству: уместность, полнота, структура, отсутствие лишнего.'
          : 'Сравните два промпта: какой лучше по уместности, полноте и структуре?'
    setJudgeLoading(true)
    setJudgeError(null)
    try {
      const j = await api.compareJudge({
        task_input: taskForJudge,
        prompt_a: promptA,
        prompt_b: promptB,
        judge_model: judgeModel.trim() || undefined,
      })
      setJudgeResult(j)
    } catch (e) {
      setJudgeError(e instanceof Error ? e.message : 'Ошибка судьи')
    } finally {
      setJudgeLoading(false)
    }
  }

  const winner = judgeResult?.winner || workspace?.winner || 'tie'

  const openWinnerInStudio = () => {
    if (!workspace) return
    const which = winner === 'tie' ? 'a' : winner
    const prompt = which === 'a' ? workspace.a.prompt : workspace.b.prompt
    navigate('/home', {
      state: {
        prefillTask: `Доработай этот промпт дальше (на его основе делай итерации):\n\n${prompt}`,
        clearResult: true,
      },
    })
  }

  const saveWinnerToLibrary = async () => {
    if (!workspace) return
    const which = winner === 'tie' ? 'a' : winner
    const prompt = which === 'a' ? workspace.a.prompt : workspace.b.prompt
    const title = mode === 'techniques'
      ? `Compare · ${taskInput.slice(0, 60) || 'задача'}`
      : `Compare · paste · ${new Date().toISOString().slice(0, 10)}`
    try {
      await api.saveToLibrary({
        title,
        prompt,
        tags: ['compare', 'winner'],
        target_model: targetModel !== 'unknown' ? targetModel : undefined,
        task_type: 'compare',
      })
      window.dispatchEvent(new CustomEvent('metaprompt-nav-refresh'))
    } catch {
      /* non-fatal */
    }
  }

  const renderModeTabs = () => (
    <div className={styles.modeTabs} role="tablist" aria-label="Режим сравнения">
      {([
        { id: 'techniques' as const, label: 'Техники', hint: 'одна задача, два набора техник' },
        { id: 'prompts' as const, label: 'Промпты', hint: 'вставьте два готовых промпта' },
        { id: 'models' as const, label: 'Модели', hint: 'coming soon' },
      ]).map((m) => (
        <button
          key={m.id}
          type="button"
          role="tab"
          aria-selected={mode === m.id}
          className={mode === m.id ? styles.modeTabActive : styles.modeTab}
          onClick={() => {
            if (m.id === 'models') return
            setMode(m.id)
            resetResults()
            setError(null)
          }}
          disabled={m.id === 'models'}
          title={m.hint}
        >
          <span className={styles.modeTabLabel}>{m.label}</span>
          <span className={styles.modeTabHint}>{m.hint}</span>
        </button>
      ))}
    </div>
  )

  return (
    <div className={`${pageStyles.page} ${styles.compare}`}>
      <div className={pageStyles.panelHeader}>
        <div>
          <h1 className="pageTitleGradient">A/B Сравнение</h1>
          <p className={pageStyles.panelSubtitle}>
            Три режима: по техникам, по готовым промптам, по моделям. После генерации — прогон на целевой модели, diff и судья.
          </p>
        </div>
        {(loading || runningOutputs) && <span className={pageStyles.infoBadge}>Работаю…</span>}
      </div>

      {renderModeTabs()}

      {mode === 'techniques' && (
        <>
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
                placeholder="Нужен промпт для извлечения ключевых метрик из финансового отчёта…"
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
                    <SelectDropdown
                      value={targetModel}
                      options={targetModelSelectOptions}
                      onChange={setTargetModel}
                      aria-label="Целевая модель"
                      variant="composer"
                      footerLink={{ to: '/models', label: 'Каталог моделей' }}
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
                      <input
                        type="range"
                        min={0.1}
                        max={EXPERT_GENERATION_TEMPERATURE_CAP}
                        step={0.05}
                        value={Math.min(temperature, EXPERT_GENERATION_TEMPERATURE_CAP)}
                        onChange={(e) =>
                          setTemperature(Math.min(parseFloat(e.target.value), EXPERT_GENERATION_TEMPERATURE_CAP))
                        }
                      />
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
              onClick={handleCompareTechniques}
              disabled={!taskInput.trim() || loading}
            >
              {loading ? 'Генерирую…' : 'Сгенерировать оба'}
            </button>
          </div>

          <p className={styles.modeExplainerHint}>
            Режим техник задаётся в каждом столбце. Наведите на «Авто»/«Вручную» — полная подсказка.
          </p>

          <div className={styles.results}>
            <div className={`${styles.column} ${styles.columnVariantA}`}>
              <h3 className={styles.columnTitleA}>Вариант A</h3>
              <div className={styles.badgeRow} aria-label="Техники варианта A">
                {renderTechBadges(techsAMode, techsAManual)}
              </div>
              <div className={`${styles.radioRow} ${styles.radioRowA}`}>
                <label title="Авто: техники подбираются по типу задачи.">
                  <input type="radio" checked={techsAMode === 'auto'} onChange={() => setTechsAMode('auto')} /> Авто
                </label>
                <label title="Вручную: в промпт попадут только отмеченные ниже техники.">
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
                        onChange={() =>
                          setTechsAManual((prev) =>
                            prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id],
                          )
                        }
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
              <div className={`${styles.radioRow} ${styles.radioRowB}`}>
                <label title="Авто: техники подбираются по типу задачи.">
                  <input type="radio" checked={techsBMode === 'auto'} onChange={() => setTechsBMode('auto')} /> Авто
                </label>
                <label title="Вручную: в промпт попадут только отмеченные ниже техники.">
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
                        onChange={() =>
                          setTechsBManual((prev) =>
                            prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id],
                          )
                        }
                      />
                      <span>{t.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {mode === 'prompts' && (
        <div className={styles.pastedBlock}>
          <div className={styles.pastedGrid}>
            <div>
              <div className={styles.fieldLabelRow}>
                <label htmlFor="paste-a">Промпт A</label>
                {pastedA.trim() ? <CopyIconButton text={pastedA} title="Копировать A" /> : null}
              </div>
              <AutoTextarea
                id="paste-a"
                className={styles.pastedTextarea}
                value={pastedA}
                onChange={(e) => setPastedA(e.target.value)}
                placeholder="Вставьте текст промпта A…"
                minHeightPx={160}
                maxHeightPx={440}
                spellCheck
              />
            </div>
            <div>
              <div className={styles.fieldLabelRow}>
                <label htmlFor="paste-b">Промпт B</label>
                {pastedB.trim() ? <CopyIconButton text={pastedB} title="Копировать B" /> : null}
              </div>
              <AutoTextarea
                id="paste-b"
                className={styles.pastedTextarea}
                value={pastedB}
                onChange={(e) => setPastedB(e.target.value)}
                placeholder="Вставьте текст промпта B…"
                minHeightPx={160}
                maxHeightPx={440}
                spellCheck
              />
            </div>
          </div>
          <div className={styles.pastedToolbar}>
            <SelectDropdown
              value={targetModel}
              options={targetModelSelectOptions}
              onChange={setTargetModel}
              aria-label="Целевая модель"
              variant="composer"
              footerLink={{ to: '/models', label: 'Каталог моделей' }}
            />
            <button
              type="button"
              className={`${styles.generateBothBtn} btn-primary`}
              onClick={handleUsePrompts}
              disabled={!pastedA.trim() || !pastedB.trim()}
            >
              Использовать эти промпты
            </button>
          </div>
        </div>
      )}

      {mode === 'models' && (
        <div className={styles.comingSoonCard}>
          <div className={styles.comingSoonEyebrow}>В разработке</div>
          <div className={styles.comingSoonTitle}>Сравнение моделей</div>
          <p className={styles.comingSoonBody}>
            Одна задача, один набор техник, две разные модели или тира (Fast / Mid / Advanced). Добавим следующим апдейтом.
            Пока используйте режим «Промпты»: сгенерируйте версию на каждой модели в Studio и вставьте сюда как A и B.
          </p>
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}

      {workspace && (
        <>
          {workspace.winnerNote && (
            <p className={styles.heuristicNote}>{workspace.winnerNote}</p>
          )}

          {/* Prompts side by side + diff */}
          <div className={styles.results}>
            <div className={`${styles.column} ${styles.columnVariantA}`}>
              <h3 className={styles.columnTitleA}>Промпт A</h3>
              {workspace.a.techniques && workspace.a.techniques.length > 0 && (
                <p className={styles.meta}>{workspace.a.techniques.map((t) => t.name).join(' + ')}</p>
              )}
              {workspace.a.reasoning && (
                <details>
                  <summary>Пояснение A</summary>
                  <div className={styles.copyRow}>
                    <CopyIconButton text={workspace.a.reasoning} title="Копировать пояснение A" />
                  </div>
                  <div className={styles.promptMarkdownWrap}>
                    <MarkdownOutput>{workspace.a.reasoning}</MarkdownOutput>
                  </div>
                </details>
              )}
              <div className={styles.copyRow}>
                <CopyIconButton text={workspace.a.prompt} title="Копировать промпт A" />
              </div>
              <div className={styles.promptMarkdownWrap}>
                <MarkdownOutput>{workspace.a.prompt}</MarkdownOutput>
              </div>
            </div>
            <div className={`${styles.column} ${styles.columnVariantB}`}>
              <h3 className={styles.columnTitleB}>Промпт B</h3>
              {workspace.b.techniques && workspace.b.techniques.length > 0 && (
                <p className={styles.meta}>{workspace.b.techniques.map((t) => t.name).join(' + ')}</p>
              )}
              {workspace.b.reasoning && (
                <details>
                  <summary>Пояснение B</summary>
                  <div className={styles.copyRow}>
                    <CopyIconButton text={workspace.b.reasoning} title="Копировать пояснение B" />
                  </div>
                  <div className={styles.promptMarkdownWrap}>
                    <MarkdownOutput>{workspace.b.reasoning}</MarkdownOutput>
                  </div>
                </details>
              )}
              <div className={styles.copyRow}>
                <CopyIconButton text={workspace.b.prompt} title="Копировать промпт B" />
              </div>
              <div className={styles.promptMarkdownWrap}>
                <MarkdownOutput>{workspace.b.prompt}</MarkdownOutput>
              </div>
            </div>
          </div>

          <details className={styles.diffBlock}>
            <summary className={styles.diffSummary}>Diff промптов A vs B</summary>
            <SimpleLineDiff before={workspace.a.prompt} after={workspace.b.prompt} />
          </details>

          {/* Metrics row */}
          {(workspace.a.metrics || workspace.b.metrics) && (
            <div className={styles.metricCompare}>
              <div>Полнота A: {scoreOf(workspace.a.metrics)}%</div>
              <div>Полнота B: {scoreOf(workspace.b.metrics)}%</div>
              <div>Токены A: {tokenEstimate(workspace.a.metrics, workspace.a.prompt)}</div>
              <div>Токены B: {tokenEstimate(workspace.b.metrics, workspace.b.prompt)}</div>
            </div>
          )}

          {/* Run on target */}
          <div className={styles.runOnTargetBar}>
            <div className={styles.runOnTargetTitle}>Прогнать на целевой модели</div>
            <SelectDropdown
              value={targetModel}
              options={concreteTargetOptions.length > 0 ? concreteTargetOptions : targetModelSelectOptions}
              onChange={setTargetModel}
              aria-label="Целевая модель для прогона"
              variant="composer"
              footerLink={{ to: '/models', label: 'Каталог моделей' }}
            />
            <button
              type="button"
              className={`${styles.secondaryBtn} btn-secondary`}
              onClick={handleRunOnTarget}
              disabled={runningOutputs || targetModel === 'unknown'}
              title={targetModel === 'unknown' ? 'Выберите конкретную модель' : 'Запустить оба промпта на этой модели'}
            >
              {runningOutputs ? 'Прогоняю…' : 'Запустить A и B'}
            </button>
          </div>
          {outputsError && <p className={styles.error}>{outputsError}</p>}

          {outputs && (
            <>
              <div className={styles.outputsHeader}>
                <span className={styles.outputsTitle}>Ответы модели {outputs.targetModel}</span>
                <span className={styles.outputsCost}>
                  ≈{(outputs.tokensA + outputs.tokensB).toLocaleString()} токенов · ${outputs.costUsd.toFixed(4)}
                </span>
              </div>
              <div className={styles.results}>
                <div className={`${styles.column} ${styles.columnVariantA}`}>
                  <h3 className={styles.columnTitleA}>Ответ A</h3>
                  <div className={styles.copyRow}>
                    <CopyIconButton text={outputs.a} title="Копировать ответ A" />
                  </div>
                  <div className={styles.promptMarkdownWrap}>
                    <MarkdownOutput>{outputs.a}</MarkdownOutput>
                  </div>
                </div>
                <div className={`${styles.column} ${styles.columnVariantB}`}>
                  <h3 className={styles.columnTitleB}>Ответ B</h3>
                  <div className={styles.copyRow}>
                    <CopyIconButton text={outputs.b} title="Копировать ответ B" />
                  </div>
                  <div className={styles.promptMarkdownWrap}>
                    <MarkdownOutput>{outputs.b}</MarkdownOutput>
                  </div>
                </div>
              </div>
              <details className={styles.diffBlock}>
                <summary className={styles.diffSummary}>Diff ответов A vs B</summary>
                <SimpleLineDiff before={outputs.a} after={outputs.b} />
              </details>
            </>
          )}

          {/* Judge */}
          <div className={styles.judgeRow}>
            <div className={styles.judgeToggle} role="group" aria-label="Что судить">
              <button
                type="button"
                className={judgeOn === 'prompts' ? styles.judgeToggleActive : styles.judgeToggleBtn}
                onClick={() => setJudgeOn('prompts')}
              >
                Судить промпты
              </button>
              <button
                type="button"
                className={judgeOn === 'outputs' ? styles.judgeToggleActive : styles.judgeToggleBtn}
                onClick={() => setJudgeOn('outputs')}
                disabled={!outputs}
                title={!outputs ? 'Сначала прогоните на целевой модели' : 'Судить ответы модели'}
              >
                Судить ответы
              </button>
            </div>
            <label className={styles.judgeLabel}>
              Модель-судья
              <input
                type="text"
                className={styles.judgeInput}
                list="compare-judge-models"
                value={judgeModel}
                onChange={(e) => setJudgeModel(e.target.value)}
                placeholder="напр. gemini_flash"
              />
              <datalist id="compare-judge-models">
                {generationOptions.map((id) => (
                  <option key={id} value={id} label={modelsMap[id] || id} />
                ))}
              </datalist>
            </label>
            <button
              type="button"
              className={`${styles.secondaryBtn} btn-secondary`}
              onClick={handleJudge}
              disabled={judgeLoading}
            >
              {judgeLoading ? 'Судья…' : 'Спросить судью'}
            </button>
          </div>
          {judgeError && <p className={styles.error}>{judgeError}</p>}

          {judgeResult && (
            <div className={styles.judgeCard}>
              <div className={styles.judgeCardTop}>
                <div
                  className={
                    judgeResult.winner === 'a'
                      ? styles.judgeWinnerA
                      : judgeResult.winner === 'b'
                        ? styles.judgeWinnerB
                        : styles.judgeWinnerTie
                  }
                >
                  {judgeResult.winner === 'tie' ? 'Ничья' : `Победитель — ${judgeResult.winner.toUpperCase()}`}
                </div>
                <div className={styles.judgeMeta}>
                  судит: {judgeOn === 'outputs' ? 'ответы модели' : 'промпты'}
                </div>
              </div>
              {judgeResult.scores && typeof judgeResult.scores === 'object' && (
                <div className={styles.judgeScoreGrid}>
                  {Object.entries(judgeResult.scores).map(([k, v]) => (
                    <div key={k} className={styles.judgeScoreItem}>
                      <div className={styles.judgeScoreKey}>{k}</div>
                      <div className={styles.judgeScoreVal}>
                        {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {judgeResult.reasoning && (
                <div className={styles.judgeReasonMd}>
                  <MarkdownOutput>{judgeResult.reasoning}</MarkdownOutput>
                </div>
              )}
            </div>
          )}

          {/* Winner actions */}
          <div className={styles.winnerActions}>
            <button type="button" className={`btn-primary ${styles.winnerBtn}`} onClick={openWinnerInStudio}>
              Открыть победителя в Studio →
            </button>
            <button type="button" className={`btn-secondary ${styles.winnerBtn}`} onClick={saveWinnerToLibrary}>
              Сохранить в библиотеку
            </button>
          </div>
        </>
      )}
    </div>
  )
}
