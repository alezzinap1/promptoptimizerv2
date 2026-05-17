import ThemedTooltip from '../../components/ThemedTooltip'
import { StreamedMarkdownOutput } from '../../lib/simulatedLlmStream'
import { computeRefinedLineDiffOps } from '../../lib/lineDiffLcs'
import type { StudioGenChatMsg } from './homeHelpers'
import type { StudioAgentChatMessageListProps } from './studioUiTypes'
import styles from '../../pages/Home.module.css'

export function StudioAgentChatMessageList(props: StudioAgentChatMessageListProps) {
  const {
    chatMessages,
    loading,
    error,
    thinkingStreamText,
    latestVersionInChat,
    promptDoneFullDiffMsgId,
    setPromptDoneFullDiffMsgId,
    handleEditPreviewApply,
    handleEditPreviewCancel,
    setVersionRestoreConfirm,
    hoveredPromptSuggestion,
    setHoveredPromptSuggestion,
    handleGenerate,
    result,
    promptType,
    setSkillSandboxLog,
    setSkillSandboxInput,
    setSkillSandboxOpen,
    skillTestRunning,
    skillTestResults,
    runSkillTestCases,
    prePromptForceContinue,
  } = props

  return (
    <>
      {chatMessages.map((m) => {
                    if (m.editPreviewCard) {
                      const ep = m.editPreviewCard
                      return (
                        <div
                          key={m.id}
                          className={`${styles.chatBubbleAssistant} ${styles.editPreviewWrap}`}
                        >
                          <div className={styles.editPreviewHead}>
                            <span className={styles.editPreviewTitle}>Превью правки</span>
                            <ThemedTooltip content={ep.instruction} side="bottom" delayMs={240} block>
                              <span className={styles.editPreviewInstr}>
                                {ep.instruction.length > 120 ? `${ep.instruction.slice(0, 120)}…` : ep.instruction}
                              </span>
                            </ThemedTooltip>
                          </div>
                          {ep.diffOps.length > 0 ? (
                            <ul className={styles.editPreviewDiff} aria-label="Построчные изменения">
                              {ep.diffOps.map((row, i) => (
                                <li
                                  key={i}
                                  className={
                                    row.kind === 'ins'
                                      ? styles.editPreviewIns
                                      : row.kind === 'del'
                                        ? styles.editPreviewDel
                                        : styles.editPreviewEq
                                  }
                                >
                                  {row.text || ' '}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <pre className={styles.editPreviewMono}>{ep.newPrompt}</pre>
                          )}
                          <div className={styles.editPreviewActions}>
                            <button
                              type="button"
                              className={styles.editPreviewApply}
                              disabled={loading}
                              onClick={() => void handleEditPreviewApply(m.id, ep.newPrompt)}
                            >
                              Применить как новую версию
                            </button>
                            <button
                              type="button"
                              className={styles.editPreviewCancel}
                              disabled={loading}
                              onClick={() => handleEditPreviewCancel(m.id)}
                            >
                              Отменить
                            </button>
                          </div>
                        </div>
                      )
                    }
                    if (m.appliedTip) {
                      return (
                        <details key={m.id} className={styles.chatBubbleTipApplied}>
                          <summary className={styles.tipAppliedSummary}>
                            <span className={styles.tipAppliedLabel}>Совет</span>
                            <span className={styles.tipAppliedSummaryText}>
                              Применён совет {m.appliedTip.index}
                            </span>
                          </summary>
                          <div className={styles.tipAppliedBody}>
                            <StreamedMarkdownOutput source={m.appliedTip.fullText} suspend={false} />
                          </div>
                        </details>
                      )
                    }
                    if (m.promptDoneCard) {
                      const card = m.promptDoneCard
                      const isOldVersion =
                        latestVersionInChat > 0 && card.version < latestVersionInChat
                      return (
                        <div
                          key={m.id}
                          className={`${styles.chatBubbleAssistant} ${styles.promptDoneWrap}`}
                        >
                          <div className={styles.promptDoneStatus} role="status">
                            <span className={styles.promptDoneCheck} aria-hidden>
                              ✓
                            </span>
                            {isOldVersion ? (
                              <ThemedTooltip content="Вернуться к этой версии промпта" side="top" delayMs={240}>
                                <button
                                  type="button"
                                  className={styles.promptDoneVersionBtn}
                                  onClick={() =>
                                    setVersionRestoreConfirm({
                                      version: card.version,
                                      prompt: card.promptSnapshot,
                                    })
                                  }
                                >
                                  v{card.version}
                                </button>
                              </ThemedTooltip>
                            ) : (
                              <span className={styles.promptDoneVersion}>v{card.version}</span>
                            )}
                            <span className={styles.promptDoneSep}>·</span>
                            <span>{card.completeness}%</span>
                            {card.tokenEstimate > 0 ? (
                              <>
                                <span className={styles.promptDoneSep}>·</span>
                                <span>≈{card.tokenEstimate.toLocaleString('ru-RU')} tok</span>
                              </>
                            ) : null}
                            <span className={styles.promptDoneSep}>·</span>
                            <span className={styles.promptDoneTech}>{card.techniquesLabel}</span>
                          </div>
                          {card.iterationDiffBase &&
                          card.iterationDiffBase !== card.promptSnapshot &&
                          card.promptSnapshot.trim() ? (
                            <>
                              <button
                                type="button"
                                className={styles.promptDoneDiffToggle}
                                aria-expanded={promptDoneFullDiffMsgId === m.id}
                                onClick={() =>
                                  setPromptDoneFullDiffMsgId((id) => (id === m.id ? null : m.id))
                                }
                              >
                                {promptDoneFullDiffMsgId === m.id ? 'Скрыть полный diff' : 'Полный diff'}
                              </button>
                              {promptDoneFullDiffMsgId === m.id ? (
                                <div className={styles.promptDoneFullDiff}>
                                  <div className={styles.promptDoneDiffTitle}>
                                    Текст промпта:{' '}
                                    {card.diff
                                      ? `v${card.diff.fromVersion} → v${card.diff.toVersion}`
                                      : `→ v${card.version}`}
                                  </div>
                                  <ul className={styles.editPreviewDiff} aria-label="Полный diff версий">
                                    {computeRefinedLineDiffOps(
                                      card.iterationDiffBase,
                                      card.promptSnapshot,
                                    ).map((row, i) => (
                                      <li
                                        key={i}
                                        className={
                                          row.kind === 'ins'
                                            ? styles.editPreviewIns
                                            : row.kind === 'del'
                                              ? styles.editPreviewDel
                                              : styles.editPreviewEq
                                        }
                                      >
                                        {row.text || ' '}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}
                            </>
                          ) : null}
                          {card.suggestions.length > 0 ? (
                            <div
                              className={styles.promptDoneSuggestionsWrap}
                              onMouseLeave={() => {
                                setHoveredPromptSuggestion((prev) =>
                                  prev?.msgId === m.id ? null : prev,
                                )
                              }}
                            >
                              <div className={styles.promptDoneActions}>
                                {card.suggestions.map((s, i) => {
                                  const tipActive =
                                    hoveredPromptSuggestion?.msgId === m.id &&
                                    hoveredPromptSuggestion.index === i
                                  return (
                                    <button
                                      key={`${m.id}-s-${i}`}
                                      type="button"
                                      className={`${styles.promptDoneChipCompact} ${
                                        tipActive ? styles.promptDoneChipCompactActive : ''
                                      }`}
                                      disabled={loading || !result?.prompt_block?.trim()}
                                      aria-describedby={
                                        tipActive ? `${m.id}-tip-preview` : undefined
                                      }
                                      onMouseEnter={() =>
                                        setHoveredPromptSuggestion({ msgId: m.id, index: i })
                                      }
                                      onClick={() => {
                                        const text = s.fullText.trim()
                                        if (!text || loading || !result?.prompt_block?.trim()) return
                                        setHoveredPromptSuggestion(null)
                                        const tipMsg: StudioGenChatMsg = {
                                          id: crypto.randomUUID(),
                                          role: 'assistant',
                                          content: '',
                                          appliedTip: { index: i + 1, fullText: text },
                                        }
                                        void handleGenerate(undefined, {
                                          forceIteration: true,
                                          feedbackOverride: text,
                                          chatAppendBeforeResult: [tipMsg],
                                        })
                                      }}
                                    >
                                      Совет {i + 1}
                                    </button>
                                  )
                                })}
                              </div>
                              {hoveredPromptSuggestion?.msgId === m.id &&
                              card.suggestions[hoveredPromptSuggestion.index] ? (
                                <div
                                  id={`${m.id}-tip-preview`}
                                  className={styles.promptDoneTipPreview}
                                  role="note"
                                >
                                  {card.suggestions[hoveredPromptSuggestion.index].fullText}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          {card.diff?.rows.length ? (
                            <div className={styles.promptDoneDiff}>
                              <div className={styles.promptDoneDiffTitle}>
                                Что изменилось (v{card.diff.fromVersion} → v{card.diff.toVersion})
                              </div>
                              <ul className={styles.promptDoneDiffList}>
                                {card.diff.rows.map((row, i) => (
                                  <li
                                    key={i}
                                    className={
                                      row.kind === 'add'
                                        ? styles.promptDoneDiffAdd
                                        : row.kind === 'rm'
                                          ? styles.promptDoneDiffRm
                                          : styles.promptDoneDiffChg
                                    }
                                  >
                                    {row.text}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ) : null}
                          {promptType === 'skill' ? (
                            <div className={styles.skillDoneBar}>
                              <button
                                type="button"
                                className={styles.skillSandboxOpenBtn}
                                disabled={loading || !result?.prompt_block?.trim()}
                                onClick={() => {
                                  setSkillSandboxLog([])
                                  setSkillSandboxInput('')
                                  setSkillSandboxOpen(true)
                                }}
                              >
                                Песочница
                              </button>
                            </div>
                          ) : null}
                          {card.skillTestCases && card.skillTestCases.length > 0 ? (
                            <details className={styles.skillTestAccordion}>
                              <summary className={styles.skillTestSummary}>
                                Тест-кейсы ({card.skillTestCases.length})
                                {skillTestRunning ? (
                                  <span className={styles.skillTestRunning}> — проверка…</span>
                                ) : null}
                              </summary>
                              <div className={styles.skillTestBody}>
                                <ol className={styles.skillTestList}>
                                  {card.skillTestCases.map((tc, idx) => (
                                    <li key={idx}>
                                      <div className={styles.skillTestUser}>{tc.user}</div>
                                      <div className={styles.skillTestExpect}>
                                        Ожидается подстрока: <code>{tc.expect_substring}</code>
                                      </div>
                                      {skillTestResults[idx] ? (
                                        <span
                                          className={
                                            skillTestResults[idx] === 'pass'
                                              ? styles.skillTestPass
                                              : styles.skillTestFail
                                          }
                                        >
                                          {skillTestResults[idx] === 'pass' ? 'OK' : 'Нет вхождения'}
                                        </span>
                                      ) : null}
                                    </li>
                                  ))}
                                </ol>
                                <button
                                  type="button"
                                  className={styles.skillTestRunAll}
                                  disabled={
                                    skillTestRunning || loading || !result?.prompt_block?.trim()
                                  }
                                  onClick={() => void runSkillTestCases(card.skillTestCases!)}
                                >
                                  Запустить все
                                </button>
                              </div>
                            </details>
                          ) : null}
                        </div>
                      )
                    }
                    if (m.role === 'assistant' && m.routerClarification) {
                      const rc = m.routerClarification
                      return (
                        <div
                          key={m.id}
                          className={`${styles.chatBubbleAssistant} ${styles.chatBubbleClarify}`}
                        >
                          <StreamedMarkdownOutput source={m.content} suspend={false} />
                          {rc.reason ? <p className={styles.routerClarifyReason}>— {rc.reason}</p> : null}
                          <button
                            type="button"
                            className={styles.routerClarifyContinue}
                            disabled={loading}
                            onClick={() => prePromptForceContinue(rc.pendingUserText, rc.routerLogId)}
                          >
                            Продолжить без уточнения
                          </button>
                        </div>
                      )
                    }
                    const isThinking = m.role === 'assistant' && m.content.startsWith('__thinking__\n')
                    const displayContent = isThinking ? m.content.slice('__thinking__\n'.length) : m.content
                    if (isThinking) {
                      const firstLine = displayContent.split('\n')[0] || 'Анализ задачи'
                      return (
                        <details key={m.id} className={styles.chatBubbleThinking}>
                          <summary className={styles.thinkingSummary}>
                            <span className={styles.thinkingLabel}>Размышления</span>
                            <span className={styles.thinkingSummaryText}>{firstLine.replace(/\*\*/g, '')}</span>
                          </summary>
                          <div className={styles.thinkingBody}>
                            <StreamedMarkdownOutput source={displayContent} suspend={false} />
                          </div>
                        </details>
                      )
                    }
                    return (
                      <div
                        key={m.id}
                        className={m.role === 'user' ? styles.chatBubbleUser : styles.chatBubbleAssistant}
                      >
                        <StreamedMarkdownOutput source={displayContent} suspend={m.role === 'user'} />
                        {m.role === 'assistant' && m.clarificationQA !== undefined ? (
                          <details className={styles.clarificationRecap}>
                            <summary>Показать вопросы и ответы</summary>
                            <div className={styles.clarificationRecapBody}>
                              {m.clarificationQA.length === 0 ? (
                                <p className={styles.clarificationRecapEmpty}>Ответы не выбраны — учтена только ваша формулировка задачи.</p>
                              ) : (
                                <ol className={styles.clarificationRecapList}>
                                  {m.clarificationQA.map((row, i) => (
                                    <li key={i}>
                                      <div className={styles.clarificationQ}>{row.question}</div>
                                      <div className={styles.clarificationA}>
                                        {row.answers.length ? row.answers.join('; ') : '—'}
                                      </div>
                                    </li>
                                  ))}
                                </ol>
                              )}
                            </div>
                          </details>
                        ) : null}
                      </div>
                    )
                  })}
                  {loading && (
                    <div className={styles.agentThinking} aria-live="polite">
                      <span className={styles.agentThinkingDots} aria-hidden="true">
                        {Array.from({ length: 6 }, (_, i) => (
                          <span key={i} className={styles.agentThinkingDot} />
                        ))}
                      </span>
                      <span className={styles.agentThinkingText}>
                        {thinkingStreamText || '\u2026'}
                      </span>
                    </div>
                  )}
      {error && <p className={styles.error}>{error}</p>}
    </>
  )
}
