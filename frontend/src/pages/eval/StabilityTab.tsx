import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import ThemedTooltip from '../../components/ThemedTooltip'
import { evalApi, type EvalRunDetail, type PreviewCostRequest } from '../../api/eval'
import StabilityComposer, { type ComposerValue } from './StabilityComposer'
import CostPreview from './CostPreview'
import RunningStream from './RunningStream'
import ResultsPanel from './ResultsPanel'
import EvalRunsHistory from './EvalRunsHistory'
import pageStyles from '../../styles/PageShell.module.css'
import css from './Stability.module.css'

/** Перенос промптов из A/B Сравнение → Стабильность (sessionStorage, одноразово). */
export const STABILITY_PREFILL_STORAGE_KEY = 'metaprompt-stability-prefill-v1'

export type StabilityDeepLink = {
  libraryIdA?: number
  libraryIdB?: number
  promptA?: string
  promptB?: string
  taskInput?: string
} | null

const DEFAULT_VALUE: ComposerValue = {
  prompt_a_text: '',
  prompt_b_text: '',
  task_input: '',
  reference_answer: '',
  n_runs: 10,
  target_model_id: 'openai/gpt-4o-mini',
  judge_model_id: 'openai/gpt-4o-mini',
  judge_secondary_model_id: '',
  synthesis_model_id: '',
  run_synthesis: true,
  embedding_model_id: 'openai/text-embedding-3-small',
  expected_output_tokens: 600,
  pair_judge_samples: 5,
  temperature: 0.7,
  preset_key: 'default_g_eval',
  rubric_id: null,
  is_pair: false,
  meta_synthesis_mode: 'full',
}

interface Props {
  generationModels?: string[]
  initialPromptA?: string
  initialPromptB?: string
  deepLink?: StabilityDeepLink
}

export default function StabilityTab({
  generationModels = [],
  initialPromptA,
  initialPromptB,
  deepLink = null,
}: Props) {
  const [value, setValue] = useState<ComposerValue>({
    ...DEFAULT_VALUE,
    prompt_a_text: initialPromptA ?? '',
    prompt_b_text: initialPromptB ?? '',
    is_pair: !!(initialPromptA && initialPromptB),
  })
  const [libraryLink, setLibraryLink] = useState<{ a: number | null; b: number | null }>({
    a: null,
    b: null,
  })
  const [runId, setRunId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<EvalRunDetail | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  useEffect(() => {
    if (!deepLink) return
    setValue((v) => ({
      ...v,
      prompt_a_text: deepLink.promptA ?? v.prompt_a_text,
      prompt_b_text: deepLink.promptB ?? v.prompt_b_text,
      task_input: deepLink.taskInput ?? v.task_input,
      is_pair: Boolean(
        (deepLink.promptB || '').trim() || deepLink.libraryIdB != null,
      ),
    }))
    setLibraryLink({
      a: deepLink.libraryIdA ?? null,
      b: deepLink.libraryIdB ?? null,
    })
  }, [deepLink])

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STABILITY_PREFILL_STORAGE_KEY)
      if (!raw) return
      sessionStorage.removeItem(STABILITY_PREFILL_STORAGE_KEY)
      const p = JSON.parse(raw) as { task_input?: string; prompt_a?: string; prompt_b?: string }
      const a = typeof p.prompt_a === 'string' ? p.prompt_a : ''
      const b = typeof p.prompt_b === 'string' ? p.prompt_b : ''
      const t = typeof p.task_input === 'string' ? p.task_input : ''
      if (!a.trim() && !t.trim()) return
      setValue(v => ({
        ...v,
        prompt_a_text: a.trim() ? a : v.prompt_a_text,
        prompt_b_text: b.trim() ? b : v.prompt_b_text,
        task_input: t.trim() ? t : v.task_input,
        is_pair: Boolean(b.trim()),
      }))
    } catch {
      /* ignore */
    }
  }, [])

  const previewPayload: PreviewCostRequest | null = useMemo(() => {
    if (!value.prompt_a_text.trim() || !value.task_input.trim()) return null
    return {
      prompt_a_text: value.prompt_a_text,
      prompt_b_text: value.is_pair ? value.prompt_b_text : null,
      task_input: value.task_input,
      reference_answer: value.reference_answer || null,
      n_runs: value.n_runs,
      target_model_id: value.target_model_id,
      judge_model_id: value.judge_model_id,
      judge_secondary_model_id: value.judge_secondary_model_id.trim() || null,
      embedding_model_id: value.embedding_model_id,
      synthesis_model_id: value.synthesis_model_id.trim() || null,
      run_synthesis: value.run_synthesis,
      expected_output_tokens: value.expected_output_tokens,
      pair_judge_samples: value.is_pair ? value.pair_judge_samples : 0,
      meta_synthesis_mode: value.meta_synthesis_mode,
    }
  }, [value])

  const startRun = async () => {
    setErr(null)
    setResult(null)
    setBusy(true)
    try {
      const res = await evalApi.createRun({
        prompt_a_text: value.prompt_a_text,
        prompt_b_text: value.is_pair ? value.prompt_b_text : null,
        task_input: value.task_input,
        reference_answer: value.reference_answer || null,
        n_runs: value.n_runs,
        target_model_id: value.target_model_id,
        judge_model_id: value.judge_model_id,
        judge_secondary_model_id: value.judge_secondary_model_id.trim() || null,
        embedding_model_id: value.embedding_model_id,
        synthesis_model_id: value.synthesis_model_id.trim() || null,
        run_synthesis: value.run_synthesis,
        expected_output_tokens: value.expected_output_tokens,
        pair_judge_samples: value.is_pair ? value.pair_judge_samples : 0,
        meta_synthesis_mode: value.meta_synthesis_mode,
        temperature: value.temperature,
        preset_key: value.preset_key,
        rubric_id: value.rubric_id,
        prompt_a_library_id: libraryLink.a ?? undefined,
        prompt_b_library_id: libraryLink.b ?? undefined,
      })
      setRunId(res.run_id)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const onDone = async (status: string) => {
    if (!runId) return
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      try {
        const detail = await evalApi.getRun(runId)
        setResult(detail)
      } catch (e) {
        setErr((e as Error).message)
      }
    }
  }

  const cancel = async () => {
    if (!runId) return
    try {
      await evalApi.cancelRun(runId)
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  const totalGenerations = value.is_pair ? value.n_runs * 2 : value.n_runs

  const onSelectFromHistory = async (id: number) => {
    setHistoryOpen(false)
    setRunId(id)
    try {
      const detail = await evalApi.getRun(id)
      setResult(detail)
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <div className={css.root}>
      <div className={`${pageStyles.panel} ${css.stabilityIntroPanel}`}>
        <div className={css.stabilityHead}>
          <div className={css.stabilityTitleRow}>
            <h2 className={pageStyles.panelTitle}>Стабильность</h2>
            <details className={css.stabilityHelp}>
              <summary className={css.stabilityHelpSum} aria-label="Справка по стабильности">
                ?
              </summary>
              <p className={css.stabilityHelpBody}>
                Несколько прогонов одного или пары промптов, оценка судьёй и метрики. Прогресс и отчёт — ниже после
                запуска.
              </p>
            </details>
          </div>
          <div className={css.stabilityHeadActions}>
            <ThemedTooltip content="Лидерборд и архив отчётов" side="bottom" delayMs={260} block>
              <Link to="/eval" className={css.stabilityStudioLink}>
                История прогонов
              </Link>
            </ThemedTooltip>
            <button type="button" className={css.ghostBtn} onClick={() => setHistoryOpen(true)}>
              История
            </button>
          </div>
        </div>
      </div>

      <div className={css.composerNarrowWrap}>
        <StabilityComposer
          value={value}
          onChange={setValue}
          onRun={startRun}
          disabled={busy || (runId !== null && !result)}
          generationModels={generationModels}
        />
      </div>

      <CostPreview payload={previewPayload} />

      {err && <div className={css.errorBox}>{err}</div>}

      {runId && !result && (
        <div className={pageStyles.panel}>
          <RunningStream runId={runId} totalGenerations={totalGenerations} onDone={onDone} onCancel={cancel} />
        </div>
      )}

      {result && (
        <div className={pageStyles.panel}>
          <ResultsPanel detail={result} />
        </div>
      )}

      {historyOpen && (
        <EvalRunsHistory onClose={() => setHistoryOpen(false)} onPick={onSelectFromHistory} />
      )}
    </div>
  )
}
