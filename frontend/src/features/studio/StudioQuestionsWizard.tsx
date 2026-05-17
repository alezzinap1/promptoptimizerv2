import type { RefObject } from 'react'
import type { GenerateResult } from '../../api/client'
import ThemedTooltip from '../../components/ThemedTooltip'
import type { StudioGenerateOptions, StudioHandleGenerate } from './studioUiTypes'
import styles from '../../pages/Home.module.css'
import checkboxList from '../../styles/CheckboxOptionList.module.css'

export type StudioQuestionsWizardProps = {
  result: GenerateResult | null
  loading: boolean
  questionCarouselIdx: number
  setQuestionCarouselIdx: React.Dispatch<React.SetStateAction<number>>
  questionState: Record<number, { options: string[]; custom: string }>
  setQuestionState: React.Dispatch<
    React.SetStateAction<Record<number, { options: string[]; custom: string }>>
  >
  questionGenOpts?: StudioGenerateOptions
  improvementWizardApplyRef: RefObject<{ basePrompt: string; feedback: string } | null>
  onGenerate: StudioHandleGenerate
}

export function StudioQuestionsWizard({
  result,
  loading,
  questionCarouselIdx,
  setQuestionCarouselIdx,
  questionState,
  setQuestionState,
  questionGenOpts,
  improvementWizardApplyRef,
  onGenerate,
}: StudioQuestionsWizardProps) {
  const qs = result?.questions || []
  const total = qs.length
  if (total === 0) return null

  const idx = Math.min(Math.max(0, questionCarouselIdx), total - 1)
  const q = qs[idx]
  const state = questionState[idx] || { options: [], custom: '' }

  const submitWizardAnswers = () => {
    const imp = improvementWizardApplyRef.current
    return onGenerate(
      qs.map((qq, i) => ({
        question: qq.question,
        answers: [
          ...(questionState[i]?.options || []),
          ...((questionState[i]?.custom || '').trim() ? [questionState[i]!.custom.trim()] : []),
        ],
      })),
      imp
        ? {
            ...questionGenOpts,
            feedbackOverride: imp.feedback,
            forceIteration: true,
            previousPromptOverride: imp.basePrompt,
          }
        : questionGenOpts,
    )
  }

  return (
    <div
      className={`${styles.questionBox} ${styles.questionBoxCompact} ${styles.questionCarousel} ${styles.wizardAgentMerged}`}
    >
      {improvementWizardApplyRef.current ? (
        <p className={styles.questionCarouselMeta} style={{ width: '100%', marginBottom: 10, lineHeight: 1.4 }}>
          Уточнения перед улучшением промпта; после «Подтвердить» придёт новая версия с учётом ответов.
        </p>
      ) : null}
      <div className={`${styles.wizardProgressWrap} ${styles.wizardProgressWrapTight}`}>
        <div className={styles.wizardProgressBar}>
          <div className={styles.wizardProgressFill} style={{ width: `${((idx + 1) / total) * 100}%` }} />
        </div>
        <span className={styles.questionCarouselMeta}>
          {idx + 1} / {total}
        </span>
      </div>
      <div className={styles.wizardQuestionBlockAgent}>
        <div className={`${styles.questionItem} ${styles.questionItemCompact}`}>
          <strong>
            {idx + 1}. {q.question}
          </strong>
          <div className={checkboxList.optionChecks} role="group" aria-label={`Варианты для вопроса ${idx + 1}`}>
            {q.options.map((option, optIdx) => (
              <label key={`${idx}-${optIdx}-${option}`} className={checkboxList.optionCheck}>
                <input
                  type="checkbox"
                  checked={state.options.includes(option)}
                  onChange={() => {
                    setQuestionState((prev) => {
                      const cur = prev[idx] ?? { options: [], custom: '' }
                      const on = cur.options.includes(option)
                      const nextOpts = on ? cur.options.filter((x) => x !== option) : [...cur.options, option]
                      return { ...prev, [idx]: { ...cur, options: nextOpts } }
                    })
                  }}
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
          <input
            value={state.custom}
            placeholder="Свой ответ (добавится к выбранным)"
            onChange={(e) =>
              setQuestionState((prev) => {
                const cur = prev[idx] ?? { options: [], custom: '' }
                return { ...prev, [idx]: { ...cur, custom: e.target.value } }
              })
            }
          />
        </div>
      </div>
      <div className={`${styles.wizardFooter} ${styles.wizardFooterCompact}`}>
        <div className={styles.wizardToolbar}>
          {idx > 0 ? (
            <ThemedTooltip content="Назад" side="top" delayMs={200}>
              <button
                type="button"
                className={styles.wizIconBtn}
                aria-label="Назад"
                onClick={() => setQuestionCarouselIdx((i) => Math.max(0, i - 1))}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M15 18l-6-6 6-6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </ThemedTooltip>
          ) : (
            <span className={styles.wizToolbarLeadSpacer} aria-hidden />
          )}
          <ThemedTooltip content="Пропустить все уточнения и сгенерировать промпт" side="top" delayMs={280} disabled={loading}>
            <button
              type="button"
              className={styles.wizTextBtn}
              disabled={loading}
              aria-label="Скип — без ответов на уточнения"
              onClick={() => onGenerate([], questionGenOpts)}
            >
              Скип
            </button>
          </ThemedTooltip>
          <span className={styles.wizToolbarGrow} aria-hidden />
          {idx < total - 1 ? (
            <ThemedTooltip content={`Вопрос ${idx + 2} из ${total}`} side="top" delayMs={220}>
              <button
                type="button"
                className={`${styles.wizIconBtn} ${styles.wizIconBtnPrimary}`}
                aria-label={`Вперёд: вопрос ${idx + 2} из ${total}`}
                onClick={() => setQuestionCarouselIdx((i) => Math.min(total - 1, i + 1))}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M9 18l6-6-6-6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </ThemedTooltip>
          ) : (
            <ThemedTooltip content="Собрать ответы со всех шагов и сгенерировать промпт" side="top" delayMs={280} disabled={loading}>
              <button
                type="button"
                className={styles.wizCreateBtn}
                disabled={loading}
                onClick={() => submitWizardAnswers()}
              >
                Подтвердить
              </button>
            </ThemedTooltip>
          )}
        </div>
      </div>
    </div>
  )
}
