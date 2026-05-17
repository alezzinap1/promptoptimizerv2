import AutoTextarea from '../../components/AutoTextarea'
import PortalDropdown from '../../components/PortalDropdown'
import SelectDropdown from '../../components/SelectDropdown'
import ThemedTooltip from '../../components/ThemedTooltip'
import TierSelector from '../../components/TierSelector'
import WorkspacePicker from '../../components/WorkspacePicker'
import {
  clampExpertGenerationTemperature,
  EXPERT_GENERATION_TEMPERATURE_CAP,
  expertLevelUsesManualTechniqueHint,
} from '../../lib/expertLevelPresets'
import { isReasoningModelId } from '../../lib/modelReasoning'
import { IconGlobe } from './StudioIcons'
import { StudioSeedCard } from './StudioSeedCard'
import type { StudioAgentComposerProps } from './studioUiTypes'
import styles from '../../pages/Home.module.css'
import cb from '../../styles/ComposerBar.module.css'
import menuStyles from '../../components/DropdownMenu.module.css'

export function StudioAgentComposer(props: StudioAgentComposerProps) {
  const {
    result,
    loading,
    suggestedActions,
    suggestionsBarExpanded,
    setSuggestionsBarExpanded,
    handleSuggestedActionClick,
    questionFollowupOpen,
    setQuestionFollowupOpen,
    questionsPanel,
    chatInput,
    setChatInput,
    handleAgentSend,
    agentChatPlaceholder,
    showSeedExample,
    onLoadSeedExample,
    activeLevelBundle,
    tier,
    setTier,
    setUseCustomGenModel,
    genModel,
    genModelSelectOptions,
    setGenModel,
    workspaces,
    workspaceId,
    setWorkspaceId,
    workspacesReady,
    promptType,
    imagePresetId,
    imagePresetSelectOptions,
    setImagePresetId,
    skillPresetId,
    skillPresetSelectOptions,
    setSkillPresetId,
    skillTargetEnv,
    skillTargetEnvSelectOptions,
    setSkillTargetEnv,
    targetModel,
    targetModelSelectOptions,
    setTargetModel,
    techniqueMode,
    setTechniqueMode,
    expertLevel,
    manualTechPickerCollapsed,
    setManualTechPickerCollapsed,
    manualTechHintDismissed,
    setManualTechHintDismissed,
    showAdvanced,
    setShowAdvanced,
    techniques,
    techMenuFilter,
    setTechMenuFilter,
    manualTechs,
    setManualTechs,
    temperature,
    setTemperature,
    topP,
    setTopP,
    topK,
    setTopK,
    questionsMode,
    setQuestionsMode,
    skillBody,
    setSkillBody,
    localSkillsForPicker,
    skillInsertOpen,
    setSkillInsertOpen,
    skillInsertBtnRef,
  } = props

  return (
              <div
                className={`${styles.agentChatComposerHost} ${
                  result?.has_questions && !result?.has_prompt ? styles.agentComposerWithWizard : ''
                }`}
              >
                {result?.has_prompt && suggestedActions.length > 0 && !loading && (
                  <div className={styles.suggestedActionsBar} role="region" aria-label="Подсказки">
                    <div
                      className={`${styles.suggestedActionsBarInner} ${
                        suggestionsBarExpanded ? styles.suggestedActionsBarInnerExpanded : styles.suggestedActionsBarInnerCollapsed
                      }`}
                    >
                      {(suggestionsBarExpanded ? suggestedActions : suggestedActions.slice(0, 3)).map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          className={styles.suggestedActionChip}
                          onClick={() => void handleSuggestedActionClick(a)}
                        >
                          {a.emoji ? <span className={styles.suggestedActionEmoji}>{a.emoji}</span> : null}
                          <span>{a.title}</span>
                        </button>
                      ))}
                      {suggestedActions.length > 3 ? (
                        <button
                          type="button"
                          className={styles.suggestedActionsMore}
                          onClick={() => setSuggestionsBarExpanded((v) => !v)}
                        >
                          {suggestionsBarExpanded ? 'Свернуть' : 'Ещё…'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                )}
                {result?.has_questions && !result?.has_prompt && (
                  <details
                    className={`${styles.agentWizardInComposer} ${styles.agentWizardDetails}`}
                    open={questionFollowupOpen}
                    onToggle={(e) => setQuestionFollowupOpen(e.currentTarget.open)}
                  >
                    <summary className={styles.agentWizardSummary}>
                      <span>Уточняющие вопросы</span>
                      {loading ? (
                        <span className={styles.agentWizardSummaryMeta}>Генерация…</span>
                      ) : null}
                    </summary>
                    <div className={styles.agentWizardDetailsBody}>{questionsPanel}</div>
                  </details>
                )}
              <div
                className={`${cb.composer} ${
                  result?.has_questions && !result?.has_prompt ? styles.agentComposerShellMerged : ''
                }`}
              >
                <AutoTextarea
                  data-studio-composer
                  className={cb.composerTextarea}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      if (!loading && chatInput.trim()) handleAgentSend()
                    }
                  }}
                  placeholder={agentChatPlaceholder}
                  minHeightPx={result?.has_questions && !result?.has_prompt ? 52 : 72}
                  maxHeightPx={280}
                  spellCheck
                />
                <div className={cb.composerFooter}>
                  <div className={cb.composerFooterRow}>
                    <div className={cb.composerFooterMid}>
                      <ThemedTooltip
                        content={`Ориентир по профилю «${activeLevelBundle.label}»: фактические токены и цена зависят от модели и длины.`}
                        side="top"
                        delayMs={280}
                        block
                      >
                        <span className={styles.studioCostHint}>
                          {activeLevelBundle.estimatedCalls} вызов(ов) · {activeLevelBundle.estimatedCostHint}
                        </span>
                      </ThemedTooltip>
                      <TierSelector
                        value={tier}
                        onChange={(t) => {
                          setTier(t)
                          if (t !== 'custom') setUseCustomGenModel(false)
                        }}
                        disabled={loading}
                      />
                      {tier === 'custom' ? (
                        <ThemedTooltip
                          content="Эта модель думает сама — упрощённый промпт даст лучший результат"
                          side="top"
                          delayMs={280}
                          disabled={!isReasoningModelId(genModel)}
                          block
                          className={styles.genModelWrap}
                        >
                          <SelectDropdown
                            value={genModel}
                            options={genModelSelectOptions}
                            onChange={(v) => {
                              setUseCustomGenModel(true)
                              setGenModel(v)
                            }}
                            aria-label="Модель генерации"
                            variant="composer"
                            disabled={loading}
                            footerLink={{ to: '/models', label: 'Добавить модель' }}
                          />
                        </ThemedTooltip>
                      ) : null}
                      <WorkspacePicker
                        workspaces={workspaces}
                        workspaceId={workspaceId}
                        onSelect={setWorkspaceId}
                        workspacesReady={workspacesReady}
                      />
                      {promptType === 'image' ? (
                        <SelectDropdown
                          value={imagePresetId}
                          options={imagePresetSelectOptions}
                          onChange={setImagePresetId}
                          aria-label="Пресет стиля для изображения"
                          variant="composer"
                          disabled={loading}
                          footerLink={{ to: '/library?tab=presets', label: 'Создать пресет…' }}
                        />
                      ) : promptType === 'skill' ? (
                        <>
                          <SelectDropdown
                            value={skillPresetId}
                            options={skillPresetSelectOptions}
                            onChange={setSkillPresetId}
                            aria-label="Пресет для генерации скилла"
                            variant="composer"
                            disabled={loading}
                            footerLink={{ to: '/library?tab=presets', label: 'Создать пресет…' }}
                          />
                          <SelectDropdown
                            value={skillTargetEnv}
                            options={skillTargetEnvSelectOptions}
                            onChange={setSkillTargetEnv}
                            aria-label="Среда для скилла"
                            variant="composer"
                            disabled={loading}
                          />
                          <SelectDropdown
                            value={targetModel}
                            options={targetModelSelectOptions}
                            onChange={setTargetModel}
                            aria-label="Целевая модель или среда для скилла"
                            variant="composer"
                            disabled={loading}
                            footerLink={{ to: '/models', label: 'Каталог моделей' }}
                            triggerContent={targetModel === 'unknown' ? <IconGlobe /> : undefined}
                            triggerClassName={targetModel === 'unknown' ? styles.targetTriggerIconOnly : ''}
                          />
                        </>
                      ) : (
                        <SelectDropdown
                          value={targetModel}
                          options={targetModelSelectOptions}
                          onChange={setTargetModel}
                          aria-label="Модель, для которой пишется промпт"
                          variant="composer"
                          disabled={loading}
                          footerLink={{ to: '/models', label: 'Каталог моделей' }}
                          triggerContent={targetModel === 'unknown' ? <IconGlobe /> : undefined}
                          triggerClassName={targetModel === 'unknown' ? styles.targetTriggerIconOnly : ''}
                        />
                      )}
                      <span className={styles.techModeMicroWrap}>
                        <ThemedTooltip
                          content={
                            techniqueMode === 'auto'
                              ? 'Техники: авто — нажмите для выбора вручную'
                              : 'Техники: вручную — нажмите для авто'
                          }
                          side="top"
                          delayMs={240}
                        >
                          <button
                            type="button"
                            className={styles.techModeMicro}
                            aria-label={techniqueMode === 'auto' ? 'Режим техник: авто' : 'Режим техник: вручную'}
                            aria-pressed={techniqueMode === 'manual'}
                            disabled={loading}
                            onClick={() => {
                              if (
                                expertLevelUsesManualTechniqueHint(expertLevel, promptType) &&
                                techniqueMode === 'manual' &&
                                manualTechPickerCollapsed
                              ) {
                                setManualTechPickerCollapsed(false)
                                return
                              }
                              setTechniqueMode((m) => (m === 'auto' ? 'manual' : 'auto'))
                            }}
                          >
                            {techniqueMode === 'auto' ? 'A' : '✎'}
                          </button>
                        </ThemedTooltip>
                        {expertLevelUsesManualTechniqueHint(expertLevel, promptType) &&
                        techniqueMode === 'manual' &&
                        manualTechPickerCollapsed &&
                        !manualTechHintDismissed ? (
                          <span
                            className={styles.seniorTechHintBubble}
                            role="status"
                            onMouseEnter={() => setManualTechHintDismissed(true)}
                          >
                            Укажите техники
                          </span>
                        ) : null}
                      </span>
                      <button
                        type="button"
                        className={cb.composerGhostBtn}
                        disabled={loading}
                        onClick={() => setShowAdvanced(!showAdvanced)}
                      >
                        {showAdvanced ? 'Меньше' : 'Доп.'}
                      </button>
                    </div>
                    <div className={cb.composerFooterEnd}>
                      <ThemedTooltip content="Отправить в чат" side="left" delayMs={240}>
                        <button
                          type="button"
                          className={cb.composerSend}
                          onClick={handleAgentSend}
                          disabled={!chatInput.trim() || loading}
                          aria-label="Отправить в чат"
                        >
                          {loading ? <span className={cb.composerSendSpinner} aria-hidden /> : <span aria-hidden>↑</span>}
                        </button>
                      </ThemedTooltip>
                    </div>
                  </div>
                </div>
                {techniqueMode === 'manual' &&
                  (!expertLevelUsesManualTechniqueHint(expertLevel, promptType) || !manualTechPickerCollapsed) && (
                  <div className={`${cb.composerInset} ${styles.techPickerInset}`}>
                    <input
                      type="search"
                      className={styles.techMenuSearch}
                      placeholder="Поиск по названию или id…"
                      value={techMenuFilter}
                      onChange={(e) => setTechMenuFilter(e.target.value)}
                      aria-label="Фильтр списка техник"
                    />
                    <div className={styles.techPickerInlineList} role="listbox" aria-label="Техники для генерации">
                      {techniques
                        .filter((t) => {
                          const q = techMenuFilter.trim().toLowerCase()
                          if (!q) return true
                          return t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q)
                        })
                        .map((t) => {
                          const on = manualTechs.includes(t.id)
                          return (
                            <button
                              key={t.id}
                              type="button"
                              role="option"
                              aria-selected={on}
                              className={`${menuStyles.menuItem} ${on ? menuStyles.menuItemActive : ''}`}
                              onClick={() => {
                                setManualTechs((prev) =>
                                  prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id],
                                )
                              }}
                            >
                              <span className={styles.techMenuCheck} aria-hidden>
                                {on ? '\u2713 ' : '\u2003'}
                              </span>
                              {t.name}
                            </button>
                          )
                        })}
                    </div>
                  </div>
                )}
                {showAdvanced && (
                  <div className={cb.composerInset}>
                    <div className={styles.advancedInline}>
                      <label className={styles.advancedInlineField}>
                        Т° {clampExpertGenerationTemperature(temperature)}
                        <ThemedTooltip
                          content="Потолок температуры для стабильного блока [PROMPT]"
                          side="top"
                          delayMs={240}
                        >
                          <span style={{ display: 'inline-block', verticalAlign: 'middle' }}>
                            <input
                              type="range"
                              min={0.1}
                              max={EXPERT_GENERATION_TEMPERATURE_CAP}
                              step={0.05}
                              value={clampExpertGenerationTemperature(temperature)}
                              disabled={loading}
                              onChange={(e) =>
                                setTemperature(clampExpertGenerationTemperature(parseFloat(e.target.value)))
                              }
                            />
                          </span>
                        </ThemedTooltip>
                      </label>
                      <label className={styles.advancedInlineField}>
                        Top-P {topP.toFixed(2)}
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={topP}
                          disabled={loading}
                          onChange={(e) => setTopP(parseFloat(e.target.value))}
                        />
                      </label>
                      <label className={styles.advancedInlineField}>
                        Top-K
                        <input
                          type="number"
                          value={topK}
                          disabled={loading}
                          onChange={(e) => setTopK(e.target.value ? Number(e.target.value) : '')}
                          className={styles.topKInput}
                        />
                      </label>
                      <label className={styles.questionsCompact}>
                        <input
                          type="checkbox"
                          checked={questionsMode}
                          disabled={loading}
                          onChange={(e) => setQuestionsMode(e.target.checked)}
                        />
                        <span>Вопросы</span>
                      </label>
                    </div>
                    <div className={styles.advancedSkillBodyBlock}>
                      <span className={styles.advancedSkillBodyTop}>
                        <span className={styles.advancedSkillBodyLabel}>Контекст скилла (опционально)</span>
                        {localSkillsForPicker.length > 0 ? (
                          <>
                            <button
                              ref={skillInsertBtnRef}
                              type="button"
                              className={styles.skillInsertFromLibBtn}
                              onClick={() => setSkillInsertOpen((o) => !o)}
                              aria-expanded={skillInsertOpen}
                              aria-haspopup="listbox"
                            >
                              Из библиотеки
                            </button>
                            <PortalDropdown
                              open={skillInsertOpen}
                              onClose={() => setSkillInsertOpen(false)}
                              anchorRef={skillInsertBtnRef}
                              minWidth={260}
                              align="right"
                            >
                              {localSkillsForPicker.map((s) => (
                                <ThemedTooltip
                                  key={s.id}
                                  content={s.description || s.title}
                                  side="right"
                                  delayMs={200}
                                  block
                                >
                                  <button
                                    type="button"
                                    role="option"
                                    className={menuStyles.menuItem}
                                    onClick={() => {
                                      setSkillBody((prev) => {
                                        const next = (prev || '').trim()
                                        const block = (s.body || '').trim()
                                        if (!block) return prev
                                        if (!next) return block
                                        return `${next}\n\n---\n${s.title}\n\n${block}`
                                      })
                                      setSkillInsertOpen(false)
                                    }}
                                  >
                                    {s.title}
                                  </button>
                                </ThemedTooltip>
                              ))}
                            </PortalDropdown>
                          </>
                        ) : null}
                      </span>
                      <span className={styles.advancedSkillBodyHint}>
                        Уходит в запрос как skill_body — контекст для генерации промпта.
                      </span>
                      <AutoTextarea
                        className={styles.advancedSkillBodyTextarea}
                        value={skillBody}
                        onChange={(e) => setSkillBody(e.target.value)}
                        placeholder="Текст скилла или инструкции…"
                        minHeightPx={44}
                        maxHeightPx={140}
                        spellCheck
                      />
                    </div>
                  </div>
                )}
              </div>
              {showSeedExample && onLoadSeedExample ? (
                <StudioSeedCard onLoad={onLoadSeedExample} />
              ) : null}
              </div>
  )
}
