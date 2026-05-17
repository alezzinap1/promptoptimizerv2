import SelectDropdown from '../../components/SelectDropdown'
import ThemedTooltip from '../../components/ThemedTooltip'
import type { ExpertLevel } from '../../lib/agentStudioModes'
import { EXPERT_DEFAULT_GEN_MODEL } from '../../lib/expertLevelPresets'
import { IMAGE_STYLES_BY_ID } from '../../lib/imageStyles'
import type { StudioAgentChatHeaderProps } from './studioUiTypes'
import styles from '../../pages/Home.module.css'

export function StudioAgentChatHeader(props: StudioAgentChatHeaderProps) {
  const {
    t,
    promptType,
    loading,
    handlePromptTypeChange,
    expertLevel,
    expertLevelSelectOptions,
    handleExpertLevelChange,
    useCustomGenModel,
    genModel,
    shortGenerationModelLabel,
    setUseCustomGenModel,
    setGenModel,
    resetAgentDialog,
    taskRefForTitles,
    taskTextTokensLoading,
    taskTextTokens,
    imagePromptTags,
    toggleImageTag,
    imageStyleMoreBtnRef,
    imageStylePickerOpen,
    setImageStylePickerOpen,
    imageDeepMode,
    setImageDeepMode,
    chatMessages,
    setChatInput,
  } = props

  return (
    <>
      <div className={styles.agentChatHeader}>
                <div className={styles.agentChatHeaderTop}>
                  <div className={styles.agentHeaderLeft}>
                    <div className={styles.agentTaskTitleRow}>
                      <h2 className="pageTitleGradient">{t.studio.taskTitle}</h2>
                      <div className={styles.promptTypeTabs}>
                        {(['text', 'image', 'skill'] as const).map((pt) => (
                          <button
                            key={pt}
                            type="button"
                            className={`${styles.promptTypeTab} ${promptType === pt ? styles.promptTypeTabActive : ''}`}
                            disabled={loading}
                            onClick={() => handlePromptTypeChange(pt)}
                          >
                            {pt === 'text' ? t.studio.tabText : pt === 'image' ? t.studio.tabImage : t.studio.tabSkill}
                          </button>
                        ))}
                      </div>
                      <SelectDropdown
                        value={expertLevel}
                        options={expertLevelSelectOptions}
                        onChange={(v) => handleExpertLevelChange(v as ExpertLevel)}
                        aria-label={t.studio.expertLevelAria}
                        variant="toolbar"
                        className={styles.expertLevelSelectWrap}
                        disabled={loading}
                        footerLink={{ to: '/help', label: t.studio.helpLevelsFooter }}
                      />
                      {useCustomGenModel ? (
                        <ThemedTooltip
                          content="Сбросить к модели профиля уровня студии (ниже — сложность Авто/Повседневный/…)"
                          side="bottom"
                          delayMs={280}
                          block
                        >
                          <span className={styles.expertLevelModelHint}>
                            <span className={styles.expertLevelModelShort}>{shortGenerationModelLabel(genModel)}</span>
                            <button
                              type="button"
                              className={styles.expertLevelModelReset}
                              disabled={loading}
                              onClick={() => {
                                setUseCustomGenModel(false)
                                setGenModel(EXPERT_DEFAULT_GEN_MODEL[expertLevel])
                              }}
                            >
                              {t.studio.resetToProfile}
                            </button>
                          </span>
                        </ThemedTooltip>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.agentNewChatBtn}
                    disabled={loading}
                    onClick={resetAgentDialog}
                  >
                    {t.studio.newChat}
                  </button>
                </div>
                {taskRefForTitles ? (
                  <div
                    className={`${styles.evalStrip} ${styles.taskTextEvalStrip}`}
                    aria-live="polite"
                  >
                    <div className={styles.evalStripLeft}>
                      {taskTextTokensLoading ? (
                        <span className={styles.evalMetaSecondary}>…</span>
                      ) : (
                        <ThemedTooltip
                          content="Токены только текста задачи (то, что улучшаем). Без system, без истории чата."
                          side="bottom"
                          delayMs={280}
                        >
                          <span className={styles.evalMetaSecondary}>
                            ≈{taskTextTokens ? taskTextTokens.tokens.toLocaleString() : '—'} tok
                          </span>
                        </ThemedTooltip>
                      )}
                      <ThemedTooltip
                        content="Размер исходной формулировки задачи; сравните с ≈tok у готового промпта справа"
                        side="bottom"
                        delayMs={280}
                      >
                        <span className={styles.evalMeta}>{t.studio.taskWord}</span>
                      </ThemedTooltip>
                    </div>
                  </div>
                ) : null}
              </div>
              {promptType === 'image' && (
                <div className={styles.imageStyleToolbar}>
                  <div className={styles.imageStylesOneRow} aria-label="Выбранные стили изображения">
                    <div className={styles.imageSelectedWrap}>
                      {imagePromptTags.map((id) => {
                        const def = IMAGE_STYLES_BY_ID[id]
                        return (
                          <ThemedTooltip key={id} content={def?.description ?? id} side="top" delayMs={240}>
                            <button
                              type="button"
                              className={styles.imageSelectedChip}
                              onClick={() => toggleImageTag(id)}
                            >
                              {def?.label ?? id}
                            </button>
                          </ThemedTooltip>
                        )
                      })}
                    </div>
                    <ThemedTooltip content="Открыть каталог стилей" side="bottom" delayMs={240}>
                      <button
                        ref={imageStyleMoreBtnRef}
                        type="button"
                        className={styles.imageStyleMenuBtn}
                        aria-label="Каталог стилей изображения"
                        aria-expanded={imageStylePickerOpen}
                        aria-haspopup="listbox"
                        onClick={() => setImageStylePickerOpen((o) => !o)}
                      >
                        Стили
                      </button>
                    </ThemedTooltip>
                  </div>
                  <ThemedTooltip
                    content="Анализирует сцену и добавляет детали освещения, перспективы и атмосферы перед генерацией промпта. Дороже по токенам, обычно точнее."
                    side="bottom"
                    delayMs={280}
                  >
                    <button
                      type="button"
                      className={`${styles.imageDeepToggle} ${imageDeepMode ? styles.imageDeepToggleOn : ''}`}
                      aria-pressed={imageDeepMode}
                      onClick={() => setImageDeepMode((v) => !v)}
                    >
                      <span className={styles.imageDeepIcon} aria-hidden>
                        🔬
                      </span>
                      <span className={styles.imageDeepToggleText}>Анализ сцены</span>
                    </button>
                  </ThemedTooltip>
                </div>
              )}
              {promptType === 'skill' && chatMessages.length === 0 ? (
                <div className={styles.skillQuickStart} aria-label="Быстрые шаблоны для скилла">
                  <span className={styles.skillQuickLabel}>Примеры</span>
                  <div className={styles.skillQuickChips}>
                    {[
                      ['Эксперт по финанализу', 'Скилл: ты — финансовый аналитик. Помогай с метриками и рисками. Формат: кратко, таблицы по запросу.\n\n'],
                      ['Редактор текстов', 'Скилл: редактор стиля. Улучшай ясность и тон, сохраняй смысл. Отвечай правками и кратким обоснованием.\n\n'],
                      ['Python-разработчик', 'Скилл: senior Python. Код с типами и тестами, объясняй шаги. Стиль: PEP8, без лишней воды.\n\n'],
                    ].map(([label, seed]) => (
                      <button
                        key={label}
                        type="button"
                        className={styles.skillQuickChip}
                        disabled={loading}
                        onClick={() => setChatInput(seed)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
    </>
  )
}
