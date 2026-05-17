import MarkdownOutput from '../../components/MarkdownOutput'
import ThemedTooltip from '../../components/ThemedTooltip'
import TranslateButton from '../../components/TranslateButton'
import { CopyIconButton, TryInGeminiButton } from '../../components/PromptToolbarIcons'
import {
  COMPLETENESS_SCORE_TITLE,
  PROMPT_COST_TITLE,
  TECHNIQUES_COUNT_TITLE,
  TOKEN_ESTIMATE_TITLE,
} from '../../lib/scoreTooltips'
import { GENERATION_ISSUE_TEXT } from './studioGenerationIssues'
import { StudioResultSkeleton } from './StudioResultSkeleton'
import type { StudioResultPanelProps } from './studioUiTypes'
import styles from '../../pages/Home.module.css'

export function StudioResultPanel(props: StudioResultPanelProps) {
  const {
    promptType,
    result,
    error,
    loading,
    issueBannerDismissed,
    setIssueBannerDismissed,
    handleRetryGeneration,
    streamedPromptIde,
    tokenEstimate,
    promptCostStr,
    navigate,
    taskInput,
    taskRefForTitles,
    setChatInput,
    showSaveDialog,
    setShowSaveDialog,
    saveTitle,
    setSaveTitle,
    saveTags,
    setSaveTags,
    saveNotes,
    setSaveNotes,
    saveLibraryTarget,
    setSaveLibraryTarget,
    saveExistingLibraryId,
    setSaveExistingLibraryId,
    saveVersionAction,
    setSaveVersionAction,
    librarySaveOptions,
    handleSaveToLibrary,
    handleQuickSave,
    versions,
    sessionId,
    setResult,
    mergeSessionVersionIntoResult,
    imageTryDataUrl,
    imageTryBusy,
    runImageTryNano,
    llmReviewBusy,
    runLlmReview,
    setPublishCommunityOpen,
    publishCommunityHintVisible,
    setPublishCommunityHintVisible,
    quickSaved,
    pickPromptTitle,
    setPromptPlaygroundLog,
    setPromptPlaygroundInput,
    setPromptPlaygroundOpen,
  } = props

  return (
        <section
          className={`${styles.panel} ${styles.resultColumn} ${styles.bareColumn} ${styles.agentStackSection} ${result?.has_prompt ? styles.resultPanelReveal : ''} ${promptType === 'skill' ? styles.resultColumnSkill : ''}`}
        >
          <div className={styles.resultColumnHeader}>
            <h2 className="pageTitleGradient">{promptType === 'skill' ? 'Скилл' : 'Результат'}</h2>
            {promptType === 'skill' ? (
              <p className={styles.resultColumnSub}>Текст ниже — тело скилла для ИИ-ассистента (не чат-ответ).</p>
            ) : null}
          </div>
          {result?.generation_issue && !issueBannerDismissed && (
            <div className={styles.issueBanner} role="alert">
              <button
                type="button"
                className={styles.issueBannerClose}
                aria-label="Закрыть предупреждение"
                onClick={() => setIssueBannerDismissed(true)}
              >
                ×
              </button>
              <p>{GENERATION_ISSUE_TEXT[result.generation_issue]}</p>
              <div className={styles.issueBannerActions}>
                <button type="button" className={`${styles.primaryAction} btn-primary`} onClick={handleRetryGeneration}>
                  Попробовать снова
                </button>
              </div>
            </div>
          )}
          {loading && !result?.has_prompt && !error ? <StudioResultSkeleton /> : null}
          {!result && !error && !loading && (
            <div className={styles.resultPlaceholder}>
              <div className={styles.resultPlaceholderIcon} aria-hidden>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="8" y1="13" x2="16" y2="13" />
                  <line x1="8" y1="17" x2="14" y2="17" />
                </svg>
              </div>
              <p className={styles.resultPlaceholderTitle}>
                {promptType === 'skill' ? 'Текст скилла появится здесь' : 'Промпт появится здесь'}
              </p>
              <p className={styles.resultPlaceholderHint}>
                {promptType === 'skill'
                  ? 'После генерации сохраните во вкладку «Скиллы» в библиотеке — запись пойдёт туда, а не в список промптов.'
                  : 'Промпт появится здесь после диалога слева.'}
              </p>
            </div>
          )}
          {result?.has_prompt && (
            <>
              <div className={styles.evalStrip}>
                <div className={styles.evalStripLeft}>
                  {result.metrics && (() => {
                    const score = Number(result.metrics.completeness_score ?? result.metrics.quality_score ?? 0)
                    return score > 0 ? (
                      <ThemedTooltip content={COMPLETENESS_SCORE_TITLE} side="bottom" delayMs={280} block>
                        <div className={styles.evalScorePrimary}>
                          <span className={styles.evalScoreLabel}>Полнота</span>
                          <div className={styles.evalBar}>
                            <div className={styles.evalBarFill} style={{ width: `${Math.min(100, score)}%` }} />
                          </div>
                          <span className={styles.evalScoreNum}>{score}%</span>
                        </div>
                      </ThemedTooltip>
                    ) : null
                  })()}
                  {result.techniques?.length > 0 && (
                    <ThemedTooltip
                      content={`${TECHNIQUES_COUNT_TITLE} Сейчас: ${result.techniques.map((t) => t.name).join(', ')}.`}
                      side="bottom"
                      delayMs={280}
                    >
                      <span className={styles.evalMeta}>{result.techniques.length} техн.</span>
                    </ThemedTooltip>
                  )}
                  {tokenEstimate > 0 && (
                    <ThemedTooltip content={TOKEN_ESTIMATE_TITLE} side="bottom" delayMs={280}>
                      <span className={styles.evalMetaSecondary}>≈{tokenEstimate.toLocaleString()} tok</span>
                    </ThemedTooltip>
                  )}
                  {promptCostStr ? (
                    <ThemedTooltip content={PROMPT_COST_TITLE} side="bottom" delayMs={280}>
                      <span className={styles.evalMetaSecondary}>{promptCostStr}</span>
                    </ThemedTooltip>
                  ) : null}
                  {result.scene_analysis_applied ? (
                    <ThemedTooltip
                      content="К промпту подмешан структурированный бриф сцены (глубокий режим)"
                      side="bottom"
                      delayMs={280}
                    >
                      <span className={styles.evalMeta}>Deep · сцена</span>
                    </ThemedTooltip>
                  ) : null}
                </div>
                <div className={styles.promptToolbar}>
                  <CopyIconButton
                    text={result.prompt_block}
                    title={promptType === 'skill' ? 'Копировать тело скилла' : 'Копировать промпт'}
                  />
                  <TryInGeminiButton prompt={result.prompt_block} />
                  <TranslateButton
                    getValue={() => result.prompt_block || ''}
                    setValue={(v) => setResult({ ...result, prompt_block: v })}
                    kind={promptType === 'skill' ? 'skill' : 'prompt'}
                    compact
                    cacheResetKey={result.session_id}
                    title="Перевести промпт RU↔EN (одной кнопкой)"
                  />
                  {promptType === 'text' && (
                    <ThemedTooltip
                      content="Проверить промпт: один раунд с выбранной моделью (POST /playground/run)"
                      side="bottom"
                      delayMs={300}
                      disabled={loading}
                    >
                      <button
                        type="button"
                        className={styles.toolbarTextBtn}
                        disabled={loading}
                        onClick={() => {
                          setPromptPlaygroundLog([])
                          setPromptPlaygroundInput('')
                          setPromptPlaygroundOpen(true)
                        }}
                      >
                        Песочница
                      </button>
                    </ThemedTooltip>
                  )}
                  {promptType === 'image' && (
                    <ThemedTooltip
                      content="Пробная генерация (OpenRouter image-модель из настроек или gemini-2.5-flash-image). Картинку можно сохранить в библиотеку вместе с промптом."
                      side="bottom"
                      delayMs={320}
                      disabled={loading || imageTryBusy}
                    >
                      <button
                        type="button"
                        className={styles.toolbarTextBtn}
                        disabled={loading || imageTryBusy}
                        onClick={() => void runImageTryNano()}
                      >
                        {imageTryBusy ? 'Рисую…' : 'Проба картинки'}
                      </button>
                    </ThemedTooltip>
                  )}
                  <span className={styles.techModeMicroWrap}>
                    <ThemedTooltip content="Опубликовать в сообществе" side="bottom" delayMs={260}>
                      <button
                        type="button"
                        className={styles.quickSaveBtn}
                        onClick={() => setPublishCommunityOpen(true)}
                      >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <circle cx="12" cy="12" r="10" />
                        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                      </svg>
                      </button>
                    </ThemedTooltip>
                    {quickSaved && publishCommunityHintVisible ? (
                      <span
                        className={styles.seniorTechHintBubble}
                        role="status"
                        onMouseEnter={() => setPublishCommunityHintVisible(false)}
                      >
                        Можно опубликовать в ленте сообщества
                      </span>
                    ) : null}
                  </span>
                  {!quickSaved && (
                    <ThemedTooltip
                      content={
                        promptType === 'skill'
                          ? 'Сохранить скилл в локальную библиотеку'
                          : 'Сохранить промпт в библиотеку на сервере'
                      }
                      side="bottom"
                      delayMs={280}
                    >
                      <button type="button" className={styles.toolbarTextBtn} onClick={handleQuickSave}>
                        <span className={styles.toolbarSaveInner}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                          </svg>
                          {promptType === 'skill' ? 'В скиллы' : 'В библиотеку'}
                        </span>
                      </button>
                    </ThemedTooltip>
                  )}
                  {quickSaved && (
                    <ThemedTooltip
                      content={
                        promptType === 'skill' ? 'Сохранено в библиотеку скиллов' : 'Сохранено в библиотеку'
                      }
                      side="bottom"
                      delayMs={240}
                    >
                      <span className={styles.quickSavedMark}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                      </span>
                    </ThemedTooltip>
                  )}
                </div>
              </div>
              <div className={styles.resultMarkdownWrap}>
                <MarkdownOutput>{streamedPromptIde}</MarkdownOutput>
              </div>
              {promptType === 'image' && imageTryDataUrl ? (
                <div className={styles.imageTryPreview}>
                  <p className={styles.imageTryPreviewLabel}>
                    Пробная картинка (Nano Banana). Сохраните промпт в библиотеку — превью прикрепится к записи.
                  </p>
                  <img src={imageTryDataUrl} alt="Пробная генерация" className={styles.imageTryPreviewImg} />
                </div>
              ) : null}
              <button
                type="button"
                className={`${styles.ideModalBtn} ${styles.llmJudgeCta}`}
                disabled={llmReviewBusy}
                onClick={() => void runLlmReview()}
              >
                {llmReviewBusy ? 'Оценка…' : 'Оценка модели (LLM-судья)'}
              </button>
              {result.target_model_type === 'reasoning' && (
                <div className={styles.reasoningBadge}>
                  Reasoning-модель — техники адаптированы: убраны CoT и step-by-step, промпт компактнее
                </div>
              )}
              {result.metrics && Array.isArray(result.metrics.improvement_tips) && result.metrics.improvement_tips.length > 0 && (
                <div className={styles.tipsBox}>
                  <div className={styles.tipsBoxHead}>
                    <strong>Что можно улучшить:</strong>
                    <ThemedTooltip
                      content="Вставить все советы в запрос на доработку одним действием"
                      side="top"
                      delayMs={280}
                      disabled={loading}
                    >
                      <button
                        type="button"
                        className={styles.tipsApplyAllBtn}
                        disabled={loading}
                        onClick={() => {
                          const tips = result.metrics?.improvement_tips as string[]
                          const body = tips.map((t, i) => `${i + 1}. ${t}`).join('\n')
                          setChatInput(`Учти и примени советы по очереди:\n${body}`)
                        }}
                      >
                        Применить всё
                      </button>
                    </ThemedTooltip>
                  </div>
                  <ul>
                    {(result.metrics.improvement_tips as string[]).map((tip, idx) => (
                      <li key={idx} className={styles.tipItem}>
                        <span className={styles.tipText}>{tip}</span>
                        <ThemedTooltip content="Автоматически применить этот совет" side="top" delayMs={260} disabled={loading}>
                          <button
                            type="button"
                            className={styles.tipApplyBtn}
                            disabled={loading}
                            onClick={() => {
                              setChatInput(`Примени совет: ${tip}`)
                            }}
                          >
                            + Применить
                          </button>
                        </ThemedTooltip>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result?.has_prompt && (
                <ThemedTooltip content={COMPLETENESS_SCORE_TITLE} side="bottom" delayMs={280} block>
                  <div className={styles.strategicHint}>
                    {promptType === 'skill'
                      ? 'Оценка полноты для скилла смотрит на структуру инструкции (роль, шаги, формат). Это не оценка «умения» будущего ассистента.'
                      : result.metrics?.prompt_analysis_mode === 'image'
                        ? 'Оценка полноты для изображений: субъект, стиль, композиция, свет/палитра, негатив, техника (эвристика на сервере). Это не оценка художественного качества картинки.'
                        : 'Оценка полноты смотрит на структуру промпта (эвристика на устройстве/сервере), а не на ответ модели в чате. Перед важным использованием проверьте текст в своей модели.'}
                  </div>
                </ThemedTooltip>
              )}
              <div className={styles.actions}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() =>
                    navigate(
                      { pathname: '/compare', search: '?mode=techniques' },
                      { state: { taskInput: result.task_input || taskInput } },
                    )
                  }
                >
                  Сравнить
                </button>
                <button
                  type="button"
                  className={`${styles.libraryBtn} btn-secondary`}
                  onClick={() => {
                    setShowSaveDialog((prev) => {
                      if (!prev) setSaveTitle(pickPromptTitle(result, taskRefForTitles))
                      return !prev
                    })
                  }}
                >
                  {promptType === 'skill' ? 'В библиотеку скиллов' : 'В библиотеку'}
                </button>
              </div>
              {showSaveDialog && (
                <div className={styles.saveBox}>
                  <h3>{promptType === 'skill' ? 'Сохранить скилл' : 'Сохранить в библиотеку'}</h3>
                  {promptType === 'skill' ? (
                    <p className={styles.saveSkillHint}>
                      Запись попадёт в <strong>Библиотека → Скиллы</strong> (локально в браузере), не в список промптов на сервере.
                    </p>
                  ) : null}
                  <label className={styles.saveFieldLabel}>
                    Название в библиотеке
                    <input
                      value={saveTitle}
                      onChange={(e) => setSaveTitle(e.target.value)}
                      placeholder="Краткое имя записи"
                      aria-describedby="save-title-hint"
                    />
                  </label>
                  <p id="save-title-hint" className={styles.saveHint}>
                    Показывается в списке карточек. Если оставить пустым — подставим название из генерации или короткий заголовок по задаче.
                  </p>
                  <input value={saveTags} onChange={(e) => setSaveTags(e.target.value)} placeholder="Теги через запятую" />
                  <textarea value={saveNotes} onChange={(e) => setSaveNotes(e.target.value)} rows={3} placeholder="Заметки" />
                  {promptType !== 'skill' ? (
                    <div className={styles.saveLibraryVersionBlock}>
                      <span className={styles.saveLibraryVersionLabel}>Куда сохранить</span>
                      <label className={styles.saveLibraryRadio}>
                        <input
                          type="radio"
                          name="save-lib-target"
                          checked={saveLibraryTarget === 'new'}
                          onChange={() => {
                            setSaveLibraryTarget('new')
                            setSaveExistingLibraryId('')
                          }}
                        />
                        Новая карточка
                      </label>
                      <label className={styles.saveLibraryRadio}>
                        <input
                          type="radio"
                          name="save-lib-target"
                          checked={saveLibraryTarget === 'existing'}
                          onChange={() => setSaveLibraryTarget('existing')}
                        />
                        Существующая карточка
                      </label>
                      {saveLibraryTarget === 'existing' ? (
                        <>
                          <label className={styles.saveLibrarySelectLabel}>
                            Карточка
                            <select
                              className={styles.saveLibrarySelect}
                              value={saveExistingLibraryId === '' ? '' : String(saveExistingLibraryId)}
                              onChange={(e) =>
                                setSaveExistingLibraryId(e.target.value === '' ? '' : Number(e.target.value))
                              }
                            >
                              <option value="">— Выберите —</option>
                              {librarySaveOptions.map((it) => (
                                <option key={it.id} value={String(it.id)}>
                                  {it.title}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className={styles.saveVersionActions}>
                            <label className={styles.saveLibraryRadio}>
                              <input
                                type="radio"
                                name="save-ver-mode"
                                checked={saveVersionAction === 'replace_latest'}
                                onChange={() => setSaveVersionAction('replace_latest')}
                              />
                              Заменить последнюю версию
                            </label>
                            <label className={styles.saveLibraryRadio}>
                              <input
                                type="radio"
                                name="save-ver-mode"
                                checked={saveVersionAction === 'append'}
                                onChange={() => setSaveVersionAction('append')}
                              />
                              Добавить новую версию
                            </label>
                          </div>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  <div className={styles.actions}>
                    <button type="button" className={`${styles.primaryAction} btn-primary`} onClick={handleSaveToLibrary}>Сохранить</button>
                    <button type="button" className="btn-ghost" onClick={() => setShowSaveDialog(false)}>Отмена</button>
                  </div>
                </div>
              )}
              {versions.length > 1 && (
                <div className={styles.versionTimeline}>
                  <div className={styles.versionTimelineHeader}>
                    <span className={styles.versionTimelineLabel}>Версии</span>
                    <span className={styles.versionTimelineCount}>{versions.length}</span>
                    {(() => {
                      const scores = versions.map((v) => {
                        const m = ((v as Record<string, unknown>).metrics || {}) as Record<string, unknown>
                        return Number(m.completeness_score ?? m.quality_score ?? 0)
                      })
                      if (scores.length < 2) return null
                      const max = Math.max(100, ...scores)
                      const w = 72
                      const h = 20
                      const step = w / (scores.length - 1)
                      const pts = scores.map((s, i) => `${i * step},${h - (s / max) * h}`).join(' ')
                      return (
                        <svg className={styles.sparkline} width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
                          <polyline points={pts} fill="none" stroke="var(--primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )
                    })()}
                  </div>
                  <div className={styles.versionPills}>
                    {([...versions].reverse()).map((item) => {
                      const v = item as Record<string, unknown>
                      const m = (v.metrics || {}) as Record<string, unknown>
                      const score = Number(m.completeness_score ?? m.quality_score ?? 0)
                      const tok = Number(m.token_estimate ?? 0)
                      const isCurrent = result?.prompt_block === String(v.final_prompt || '')
                      const versionTip = `v${String(v.version)} · ${String(v.created_at || '')}${score ? ` · ${score}%` : ''}${tok ? ` · ≈${tok} tok` : ''}`
                      return (
                        <ThemedTooltip key={String(v.version)} content={versionTip} side="top" delayMs={240}>
                          <button
                            type="button"
                            className={`${styles.versionPill} ${isCurrent ? styles.versionPillActive : ''}`}
                            onClick={() =>
                              setResult((prev) =>
                                prev && sessionId
                                  ? mergeSessionVersionIntoResult(prev, v, sessionId)
                                  : prev,
                              )
                            }
                          >
                            <span className={styles.versionPillNum}>v{String(v.version)}</span>
                            {score > 0 && <span className={styles.versionPillScore}>{score}%</span>}
                          </button>
                        </ThemedTooltip>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
          {result &&
            result.llm_raw?.trim() &&
            !result.has_prompt &&
            (!result.has_questions || !result.questions?.length) && (
            <div className={styles.rawFallback}>
              <p className={styles.info}>
                Ответ модели не удалось разобрать по маркерам [PROMPT] / [QUESTIONS]. Ниже — полный текст; при необходимости скопируйте промпт вручную.
              </p>
              <details open>
                <summary>Текст ответа модели</summary>
                <div className={styles.preToolbar}>
                  <CopyIconButton text={result.llm_raw} title="Копировать ответ модели" />
                </div>
                <pre className={styles.llmRaw}>{result.llm_raw}</pre>
              </details>
            </div>
          )}
        </section>
  )
}
