import { useEffect, useState } from 'react'
import { evalApi, type EvalRubricCustom, type EvalRubricPreset } from '../../api/eval'
import css from './Stability.module.css'

export interface ComposerValue {
  prompt_a_text: string
  prompt_b_text: string
  task_input: string
  reference_answer: string
  n_runs: number
  target_model_id: string
  judge_model_id: string
  judge_secondary_model_id: string
  synthesis_model_id: string
  run_synthesis: boolean
  embedding_model_id: string
  expected_output_tokens: number
  pair_judge_samples: number
  temperature: number
  preset_key: string | null
  rubric_id: number | null
  is_pair: boolean
}

const CHEAP_JUDGE_OPTIONS = [
  'openai/gpt-4o-mini',
  'anthropic/claude-3-haiku',
  'google/gemini-2.0-flash-001',
  'deepseek/deepseek-v4-flash',
  'qwen/qwen3-235b-a22b',
]

const CHEAP_EMBEDDING_OPTIONS = [
  'openai/text-embedding-3-small',
  'openai/text-embedding-3-large',
]

interface Props {
  value: ComposerValue
  onChange: (v: ComposerValue) => void
  onRun: () => void
  disabled?: boolean
  generationModels: string[]
}

export default function StabilityComposer({ value, onChange, onRun, disabled, generationModels }: Props) {
  const [presets, setPresets] = useState<EvalRubricPreset[]>([])
  const [customRubrics, setCustomRubrics] = useState<EvalRubricCustom[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    evalApi
      .listRubrics()
      .then(r => {
        if (cancelled) return
        setPresets(r.presets)
        setCustomRubrics(r.custom)
      })
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [])

  const set = <K extends keyof ComposerValue>(k: K, v: ComposerValue[K]) => onChange({ ...value, [k]: v })

  return (
    <div className={css.composer}>
      <div className={css.fieldGrid}>
        <div className={css.modeToggle}>
          <button
            type="button"
            className={!value.is_pair ? css.modeBtnActive : css.modeBtn}
            onClick={() => set('is_pair', false)}
          >
            Один промпт (стабильность)
          </button>
          <button
            type="button"
            className={value.is_pair ? css.modeBtnActive : css.modeBtn}
            onClick={() => set('is_pair', true)}
          >
            A vs B (с судьёй)
          </button>
        </div>

        <div>
          <div className={css.label}>Prompt A {value.is_pair ? '(основной)' : ''}</div>
          <textarea
            className={css.textarea}
            value={value.prompt_a_text}
            onChange={e => set('prompt_a_text', e.target.value)}
            placeholder="Системный промпт, который мы прогоним N раз"
          />
        </div>

        {value.is_pair && (
          <div>
            <div className={css.label}>Prompt B</div>
            <textarea
              className={css.textarea}
              value={value.prompt_b_text}
              onChange={e => set('prompt_b_text', e.target.value)}
              placeholder="Альтернативный промпт для сравнения"
            />
          </div>
        )}

        <div>
          <div className={css.label}>Входные данные (одинаковы для всех итераций)</div>
          <textarea
            className={css.textarea}
            value={value.task_input}
            onChange={e => set('task_input', e.target.value)}
            placeholder="Что подаётся в качестве user-сообщения"
          />
        </div>

        <div>
          <div className={css.label}>Эталон (опционально, для reference-based рубрик)</div>
          <textarea
            className={css.textarea}
            value={value.reference_answer}
            onChange={e => set('reference_answer', e.target.value)}
            placeholder="Если рубрика требует — приведите эталонный ответ"
          />
        </div>

        <div className={css.row3}>
          <div>
            <div className={css.label}>N итераций</div>
            <input
              className={css.numberInput}
              type="number"
              min={1}
              max={50}
              value={value.n_runs}
              onChange={e => set('n_runs', Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
            />
          </div>
          <div>
            <div className={css.label}>Целевая модель</div>
            <select
              className={css.input}
              value={value.target_model_id}
              onChange={e => set('target_model_id', e.target.value)}
            >
              {generationModels.length === 0 && (
                <option value={value.target_model_id}>{value.target_model_id}</option>
              )}
              {generationModels.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <div className={css.label}>Temperature</div>
            <input
              className={css.numberInput}
              type="number"
              step={0.1}
              min={0}
              max={2}
              value={value.temperature}
              onChange={e => set('temperature', Number(e.target.value) || 0)}
            />
          </div>
        </div>

        <div className={css.row3}>
          <div>
            <div className={css.label}>Судья (LLM)</div>
            <select className={css.input} value={value.judge_model_id} onChange={e => set('judge_model_id', e.target.value)}>
              {CHEAP_JUDGE_OPTIONS.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <div className={css.label}>Второй судья (MVP-1.5)</div>
            <select
              className={css.input}
              value={value.judge_secondary_model_id || ''}
              onChange={e => set('judge_secondary_model_id', e.target.value)}
            >
              <option value="">— нет —</option>
              {CHEAP_JUDGE_OPTIONS.filter(m => m !== value.judge_model_id).map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <div className={css.help}>Средний |Δ баллов| по прогону показывается в отчёте.</div>
          </div>
          <div>
            <div className={css.label}>Модель мета-анализа</div>
            <select
              className={css.input}
              value={value.synthesis_model_id || ''}
              onChange={e => set('synthesis_model_id', e.target.value)}
              disabled={!value.run_synthesis}
            >
              <option value="">Как у первого судьи</option>
              {CHEAP_JUDGE_OPTIONS.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        <div className={css.row3}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label className={css.inlineCheck}>
              <input
                type="checkbox"
                checked={value.run_synthesis}
                onChange={e => set('run_synthesis', e.target.checked)}
              />
              <span>После прогона — один вызов LLM: слабые места промпта и рекомендации (по всем ответам сразу)</span>
            </label>
          </div>
        </div>

        <div className={css.row3}>
          <div>
            <div className={css.label}>Эмбеддинги</div>
            <select className={css.input} value={value.embedding_model_id} onChange={e => set('embedding_model_id', e.target.value)}>
              {CHEAP_EMBEDDING_OPTIONS.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <div className={css.label}>Бюджет вывода (tokens)</div>
            <input
              className={css.numberInput}
              type="number"
              min={50}
              max={4000}
              value={value.expected_output_tokens}
              onChange={e => set('expected_output_tokens', Math.max(50, Math.min(4000, Number(e.target.value) || 50)))}
            />
          </div>
        </div>

        <div className={css.row2}>
          <div>
            <div className={css.label}>Рубрика</div>
            <select
              className={css.input}
              value={value.rubric_id ? `c:${value.rubric_id}` : `p:${value.preset_key ?? ''}`}
              onChange={e => {
                const v = e.target.value
                if (v.startsWith('c:')) {
                  set('rubric_id', Number(v.slice(2)))
                  set('preset_key', null)
                } else {
                  set('rubric_id', null)
                  set('preset_key', v.slice(2))
                }
              }}
            >
              <optgroup label="Готовые">
                {presets.map(p => (
                  <option key={p.preset_key} value={`p:${p.preset_key}`}>{p.name}</option>
                ))}
              </optgroup>
              {customRubrics.length > 0 && (
                <optgroup label="Свои">
                  {customRubrics.map(r => (
                    <option key={r.id} value={`c:${r.id}`}>{r.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
            <div className={css.help}>Critique-rubric для LLM-судьи. Список из стандартных пресетов.</div>
          </div>
          {value.is_pair && (
            <div>
              <div className={css.label}>Pair-judge выборок</div>
              <input
                className={css.numberInput}
                type="number"
                min={0}
                max={20}
                value={value.pair_judge_samples}
                onChange={e => set('pair_judge_samples', Math.max(0, Math.min(20, Number(e.target.value) || 0)))}
              />
              <div className={css.help}>Сколько раз судья сравнит A vs B напрямую. 0 = не сравнивать.</div>
            </div>
          )}
        </div>
      </div>

      {error && <div className={css.errorBox}>{error}</div>}

      <div className={css.runFooter}>
        <span className={css.muted} style={{ fontSize: 12 }}>
          Run прогонит prompt {value.is_pair ? 'A и B' : 'A'} <b>{value.n_runs}×</b> и оценит результаты судьёй + эмбеддингами.
        </span>
        <button type="button" onClick={onRun} disabled={disabled} className={css.runBtn}>
          {disabled ? 'Подождите…' : 'Запустить run'}
        </button>
      </div>
    </div>
  )
}
