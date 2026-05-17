import { createPortal } from 'react-dom'
import MarkdownOutput from '../../components/MarkdownOutput'
import ThemedTooltip from '../../components/ThemedTooltip'
import { LLM_REVIEW_DOCK_HELP } from './studioHomeConstants'
import { LlmReviewIconClose, LlmReviewIconMaximize, LlmReviewIconRestore } from './LlmReviewIcons'
import type { StudioLlmReviewDockProps } from './studioUiTypes'
import styles from '../../pages/Home.module.css'

export function StudioLlmReviewDock({
  llmReviewOpen,
  llmReviewMaximized,
  setLlmReviewMaximized,
  setLlmReviewOpen,
  llmReviewBusy,
  llmReviewThinkingLine,
  llmReviewModel,
  llmReviewFromCache,
  streamedLlmReviewBody,
  llmReviewText,
  llmReviewHints,
  llmReviewHintsOpen,
  setLlmReviewHintsOpen,
  loading,
  setChatInput,
  runLlmReview,
}: StudioLlmReviewDockProps) {
  if (!llmReviewOpen) return null

  return createPortal(
    <div className={styles.llmReviewDockLayer} role="presentation">
      <div
        className={`${styles.llmReviewDockCard}${llmReviewMaximized ? ` ${styles.llmReviewDockCardMaximized}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="llm-review-dock-title"
      >
        <div className={styles.llmReviewDockHead}>
          <div className={styles.llmReviewDockTitleRow}>
            <h3 id="llm-review-dock-title" className={styles.llmReviewDockTitle}>
              Оценка промпта (LLM)
            </h3>
            <ThemedTooltip content={LLM_REVIEW_DOCK_HELP} side="top" delayMs={280}>
              <button
                type="button"
                className={styles.llmReviewDockHelpMark}
                aria-label={`Справка: ${LLM_REVIEW_DOCK_HELP}`}
              >
                ?
              </button>
            </ThemedTooltip>
          </div>
          <div className={styles.llmReviewDockHeadTools}>
            <ThemedTooltip
              content={llmReviewMaximized ? 'Обычный размер окна' : 'Развернуть на весь экран'}
              side="bottom"
              delayMs={200}
            >
              <button
                type="button"
                className={styles.llmReviewDockIconBtn}
                onClick={() => setLlmReviewMaximized((m) => !m)}
                aria-label={llmReviewMaximized ? 'Обычный размер окна' : 'Развернуть на весь экран'}
              >
                {llmReviewMaximized ? <LlmReviewIconRestore /> : <LlmReviewIconMaximize />}
              </button>
            </ThemedTooltip>
            <ThemedTooltip content="Закрыть" side="bottom" delayMs={200}>
              <button
                type="button"
                className={styles.llmReviewDockClose}
                onClick={() => {
                  setLlmReviewMaximized(false)
                  setLlmReviewOpen(false)
                }}
                aria-label="Закрыть"
              >
                <LlmReviewIconClose />
              </button>
            </ThemedTooltip>
          </div>
        </div>
        <div className={styles.llmReviewDockMeta}>
          <span className={styles.llmReviewDockMetaMain}>
            {llmReviewBusy
              ? llmReviewThinkingLine || 'Запрос…'
              : llmReviewModel
                ? `${llmReviewModel}${llmReviewFromCache ? ' · из кэша' : ''}`
                : '—'}
          </span>
        </div>
        <div className={styles.llmReviewDockGrow}>
          <div className={styles.llmReviewDockScroll}>
            {llmReviewBusy ? (
              <div className={styles.auxThinkingLine} aria-live="polite">
                <span className={styles.auxThinkingDots} aria-hidden>
                  <span />
                  <span />
                  <span />
                </span>
                <span>{llmReviewThinkingLine || 'Запрос к судье…'}</span>
              </div>
            ) : (
              <MarkdownOutput>{streamedLlmReviewBody || (llmReviewBusy ? '' : '—')}</MarkdownOutput>
            )}
          </div>
          {!llmReviewBusy && llmReviewHints.length > 0 && !llmReviewText.startsWith('Ошибка:') ? (
            <div className={styles.llmReviewHintsShell}>
              <div className={styles.llmReviewHintsBar}>
                <button
                  type="button"
                  className={styles.llmReviewHintsToggle}
                  aria-expanded={llmReviewHintsOpen}
                  onClick={() => setLlmReviewHintsOpen((o) => !o)}
                >
                  Быстрые шаги ({llmReviewHints.length})
                  <span className={styles.llmReviewHintsToggleChev}>
                    {llmReviewHintsOpen ? ' ▲' : ' ▼'}
                  </span>
                </button>
                <button
                  type="button"
                  className={styles.llmReviewHintsAllBtn}
                  disabled={loading}
                  onClick={() => {
                    const body = llmReviewHints.map((t, i) => `${i + 1}. ${t}`).join('\n')
                    setChatInput(`Учти по очереди советы судьи:\n${body}`)
                    setLlmReviewOpen(false)
                  }}
                >
                  Всё в чат
                </button>
              </div>
              {llmReviewHintsOpen ? (
                <div className={styles.llmReviewHintsBox}>
                  <ul className={styles.llmReviewHintsList}>
                    {llmReviewHints.map((tip, idx) => (
                      <li key={idx} className={styles.llmReviewHintRow}>
                        <span className={styles.llmReviewHintText}>{tip}</span>
                        <button
                          type="button"
                          className={styles.llmReviewHintBtn}
                          disabled={loading}
                          onClick={() => {
                            setChatInput(`Учти совет судьи: ${tip}`)
                            setLlmReviewOpen(false)
                          }}
                        >
                          В чат
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {!llmReviewBusy && llmReviewText && !llmReviewText.startsWith('Ошибка:') ? (
          <div className={styles.llmReviewDockActions}>
            <button type="button" className={styles.ideModalBtn} onClick={() => void runLlmReview(true)}>
              Свежая оценка (ещё один запрос)
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
