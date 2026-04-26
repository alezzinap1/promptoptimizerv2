import { useEffect, useState } from 'react'
import { evalApi, type EvalRubricCustom, type EvalRubricPreset } from '../../api/eval'
import LibraryPickButton from '../../components/LibraryPickButton'
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
  meta_synthesis_mode: 'full' | 'lite'
}

const LS_ADVANCED = 'eval-stability-advanced-open'

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

function readAdvancedOpen(): boolean {
  try {
    return window.localStorage.getItem(LS_ADVANCED) === '1'
  } catch {
    return false
  }
}

function writeAdvancedOpen(open: boolean) {
  try {
    window.localStorage.setItem(LS_ADVANCED, open ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export default function StabilityComposer({ value, onChange, onRun, disabled, generationModels }: Props) {
  const [presets, setPresets] = useState<EvalRubricPreset[]>([])
  const [customRubrics, setCustomRubrics] = useState<EvalRubricCustom[]>([])
  const [error, setError] = useState<string | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(readAdvancedOpen)
  const [secondJudgeOpen, setSecondJudgeOpen] = useState(() =>
    Boolean((value.judge_secondary_model_id || '').trim()),
  )

  useEffect(() => {
    if ((value.judge_secondary_model_id || '').trim()) setSecondJudgeOpen(true)
  }, [value.judge_secondary_model_id])

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

  const toggleAdvanced = () => {
    setAdvancedOpen(v => {
      const n = !v
      writeAdvancedOpen(n)
      return n
    })
  }

  const removeSecondJudge = () => {
    setSecondJudgeOpen(false)
    set('judge_secondary_model_id', '')
  }

  return (
    <div className={css.composer}>
      <div className={css.fieldGrid}>
        <div className={css.modeToggle}>
          <button
            type="button"
            className={!value.is_pair ? css.modeBtnActive : css.modeBtn}
            onClick={() => set('is_pair', false)}
          >
            Один промпт
          </button>
          <button
            type="button"
            className={value.is_pair ? css.modeBtnActive : css.modeBtn}
            onClick={() => set('is_pair', true)}
          >
            Пара A vs B
          </button>
        </div>

        <div>
          <div className={css.labelRow}>
            <div className={css.labelCluster}>
              <div className={css.label}>Системный промпт {value.is_pair ? '(A)' : ''}</div>
              <LibraryPickButton applyMode="prompt" onApply={(t) => set('prompt_a_text', t)} disabled={disabled} />
            </div>
          </div>
          <textarea
            className={css.textarea}
            value={value.prompt_a_text}
            onChange={e => set('prompt_a_text', e.target.value)}
            placeholder="Текст системного промпта, который будет прогнан N раз на целевой модели"
          />
        </div>

        {value.is_pair && (
          <div>
            <div className={css.labelRow}>
              <div className={css.labelCluster}>
                <div className={css.label}>Системный промпт B</div>
                <LibraryPickButton applyMode="prompt" onApply={(t) => set('prompt_b_text', t)} disabled={disabled} />
              </div>
            </div>
            <textarea
              className={css.textarea}
              value={value.prompt_b_text}
              onChange={e => set('prompt_b_text', e.target.value)}
              placeholder="Альтернативный промпт для сравнения в паре"
            />
          </div>
        )}

        <div>
          <div className={css.labelRow}>
            <div className={css.labelCluster}>
              <div className={css.label}>Тестовый запрос (user)</div>
              <LibraryPickButton applyMode="user_turn" onApply={(t) => set('task_input', t)} disabled={disabled} />
            </div>
          </div>
          <div className={css.help} style={{ marginTop: 0, marginBottom: 6 }}>
            Одинаков для всех итераций — имитирует пользовательское сообщение к модели.
          </div>
          <textarea
            className={css.textarea}
            value={value.task_input}
            onChange={e => set('task_input', e.target.value)}
            placeholder="Например: «Проанализируй следующий текст…» + данные"
          />
        </div>

        <div className={css.row2}>
          <div>
            <div className={css.label}>Число итераций (N)</div>
            <input
              className={css.numberInput}
              type="number"
              min={1}
              max={50}
              value={value.n_runs}
              onChange={e => set('n_runs', Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
            />
            <div className={css.help}>Каждая итерация — отдельный вызов модели и оценка судьёй.</div>
          </div>
          <div>
            <div className={css.label}>Рубрика судьи</div>
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
            <div className={css.help}>Критерии оценки ответов для LLM-судьи.</div>
          </div>
        </div>

        <button type="button" className={css.advancedToggle} onClick={toggleAdvanced} aria-expanded={advancedOpen}>
          <span className={css.advancedToggleIcon} aria-hidden>{advancedOpen ? '▼' : '▶'}</span>
          <span>
            <strong>Расширенные настройки</strong>
            <span className={css.advancedToggleHint}> Модели, температура, эталон, эмбеддинги, второй судья</span>
          </span>
        </button>

        {advancedOpen && (
          <div className={css.advancedPanel}>
            <div>
              <div className={css.label}>Эталон (опционально)</div>
              <div className={css.help} style={{ marginTop: 0, marginBottom: 6 }}>
                Нужен только если выбранная рубрика требует эталонный ответ.
              </div>
              <textarea
                className={css.textarea}
                value={value.reference_answer}
                onChange={e => set('reference_answer', e.target.value)}
                placeholder="Оставьте пустым, если рубрика не использует reference"
              />
            </div>

            <div className={css.row3}>
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
              <div>
                <div className={css.label}>Ожидаемая длина ответа (tokens)</div>
                <input
                  className={css.numberInput}
                  type="number"
                  min={50}
                  max={4000}
                  value={value.expected_output_tokens}
                  onChange={e =>
                    set('expected_output_tokens', Math.max(50, Math.min(4000, Number(e.target.value) || 50)))
                  }
                />
              </div>
            </div>

            <div className={css.row3}>
              <div>
                <div className={css.label}>Модель эмбеддингов</div>
                <select
                  className={css.input}
                  value={value.embedding_model_id}
                  onChange={e => set('embedding_model_id', e.target.value)}
                >
                  {CHEAP_EMBEDDING_OPTIONS.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <div className={css.label}>Судья</div>
                <select
                  className={css.input}
                  value={value.judge_model_id}
                  onChange={e => set('judge_model_id', e.target.value)}
                >
                  {CHEAP_JUDGE_OPTIONS.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>

            {!secondJudgeOpen ? (
              <button type="button" className={css.linkishBtn} onClick={() => setSecondJudgeOpen(true)}>
                + Добавить второго судью (согласованность оценок)
              </button>
            ) : (
              <div>
                <div className={css.labelRowSpread}>
                  <span>Второй судья</span>
                  <button type="button" className={css.linkishBtn} onClick={removeSecondJudge}>
                    Убрать
                  </button>
                </div>
                <div className={css.help} style={{ marginBottom: 6 }}>
                  Независимая оценка тех же ответов. В отчёте — среднее расхождение |Δ балл| между судьями.
                </div>
                <select
                  className={css.input}
                  value={value.judge_secondary_model_id || ''}
                  onChange={e => set('judge_secondary_model_id', e.target.value)}
                >
                  <option value="">— выберите модель —</option>
                  {CHEAP_JUDGE_OPTIONS.filter(m => m !== value.judge_model_id).map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            )}

            <div className={css.synthesisBlock}>
              <label className={css.inlineCheck}>
                <input
                  type="checkbox"
                  checked={value.run_synthesis}
                  onChange={e => set('run_synthesis', e.target.checked)}
                />
                <span>
                  <strong>Мета-анализ после прогона</strong> — слабые места промпта и рекомендации по всем ответам
                </span>
              </label>
              {value.run_synthesis && (
                <div className={css.synthesisRow}>
                  <div>
                    <div className={css.label}>Профиль мета-анализа</div>
                    <select
                      className={css.input}
                      value={value.meta_synthesis_mode}
                      onChange={e => set('meta_synthesis_mode', e.target.value === 'lite' ? 'lite' : 'full')}
                    >
                      <option value="lite">Экономный (1× LLM, быстрее и дешевле)</option>
                      <option value="full">Полный v2 (кластеры, гипотезы, цитаты)</option>
                    </select>
                  </div>
                  <div>
                    <div className={css.label}>Модель для мета-анализа</div>
                    <select
                      className={css.input}
                      value={value.synthesis_model_id || ''}
                      onChange={e => set('synthesis_model_id', e.target.value)}
                    >
                      <option value="">Как у первого судьи</option>
                      {CHEAP_JUDGE_OPTIONS.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>

            {value.is_pair && (
              <div>
                <div className={css.label}>Прямых сравнений A vs B (pair-judge)</div>
                <input
                  className={css.numberInput}
                  type="number"
                  min={0}
                  max={20}
                  value={value.pair_judge_samples}
                  onChange={e =>
                    set('pair_judge_samples', Math.max(0, Math.min(20, Number(e.target.value) || 0)))
                  }
                />
                <div className={css.help}>Сколько раз отдельный вызов судьи сравнивает ответы A и B. 0 — не вызывать.</div>
              </div>
            )}
          </div>
        )}
      </div>

      {error && <div className={css.errorBox}>{error}</div>}

      <div className={css.runFooter}>
        <span className={css.muted} style={{ fontSize: 12 }}>
          Будет выполнено {value.is_pair ? `${value.n_runs}×2` : value.n_runs} генераций, затем оценка судьёй и эмбеддинги.
        </span>
        <button type="button" onClick={onRun} disabled={disabled} className={css.runBtn}>
          {disabled ? 'Подождите…' : 'Запустить прогон'}
        </button>
      </div>
    </div>
  )
}
