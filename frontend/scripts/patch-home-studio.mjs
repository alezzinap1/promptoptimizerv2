import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const homePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/pages/Home.tsx')
let lines = fs.readFileSync(homePath, 'utf8').split(/\r?\n/)

// Remove GENERATION_ISSUE_TEXT block (1-based 450-459)
lines = lines.filter((_, i) => i < 449 || i >= 459)

// Find resultSection after filter - search again
let startResult = lines.findIndex((l) => l.trim().startsWith('const resultSection = ('))
let endResult = lines.findIndex((l, i) => i > startResult && l.trim() === ')')
if (startResult < 0) throw new Error('resultSection not found')

// endResult is closing paren of assignment - line after section ends with `  )` before return
// Original: `  )` alone after `        </section>`
for (let i = startResult; i < lines.length; i++) {
  if (lines[i].trim() === ')' && lines[i - 1]?.includes('</section>')) {
    endResult = i
    break
  }
}

const beforeReturn = lines.findIndex((l) => l.trim() === 'return (' && lines.slice(Math.max(0, l - 3), l).some((x) => x.includes('HomeOnboardingHints') || x.includes('homeFlexFill')))
// insert helper comment before return - actually replace resultSection with nothing, use component in JSX

lines.splice(startResult, endResult - startResult + 1)

// Add imports after StudioIcons import
const iconImportIdx = lines.findIndex((l) => l.includes("from '../features/studio/StudioIcons'"))
const importsToAdd = [
  "import { StudioResultPanel } from '../features/studio/StudioResultPanel'",
  "import { StudioAgentChatHeader } from '../features/studio/StudioAgentChatHeader'",
  "import { StudioAgentChatMessageList } from '../features/studio/StudioAgentChatMessageList'",
  "import { StudioAgentComposer } from '../features/studio/StudioAgentComposer'",
  "import { StudioLlmReviewDock } from '../features/studio/StudioLlmReviewDock'",
]
if (!lines.some((l) => l.includes('StudioResultPanel'))) {
  lines.splice(iconImportIdx + 1, 0, ...importsToAdd)
}

// Remove unused imports if any - LLM_REVIEW_DOCK_HELP still used? only in dock now
// LlmReviewIcon* only in dock

const home = lines.join('\n')

// Replace agent chat column inner content: from agentChatColumn to end of composer (before split gutter)
// Pattern: <div className={styles.agentChatColumn}> ... </div> (closes column)
const colStart = home.indexOf('<div className={styles.agentChatColumn}>')
const gutterStart = home.indexOf('role="separator"', colStart)
if (colStart < 0 || gutterStart < 0) throw new Error('markers not found')

const replacement = `<div className={styles.agentChatColumn}>
              <StudioAgentChatHeader
                t={t}
                promptType={promptType}
                loading={loading}
                handlePromptTypeChange={handlePromptTypeChange}
                expertLevel={expertLevel}
                expertLevelSelectOptions={expertLevelSelectOptions}
                handleExpertLevelChange={handleExpertLevelChange}
                useCustomGenModel={useCustomGenModel}
                genModel={genModel}
                shortGenerationModelLabel={shortGenerationModelLabel}
                setUseCustomGenModel={setUseCustomGenModel}
                setGenModel={setGenModel}
                resetAgentDialog={resetAgentDialog}
                taskRefForTitles={taskRefForTitles}
                taskTextTokensLoading={taskTextTokensLoading}
                taskTextTokens={taskTextTokens}
                imagePromptTags={imagePromptTags}
                toggleImageTag={toggleImageTag}
                imageStyleMoreBtnRef={imageStyleMoreBtnRef}
                imageStylePickerOpen={imageStylePickerOpen}
                setImageStylePickerOpen={setImageStylePickerOpen}
                imageDeepMode={imageDeepMode}
                setImageDeepMode={setImageDeepMode}
                chatMessages={chatMessages}
                setChatInput={setChatInput}
              />
              <div className={styles.agentChatBody}>
                <div
                  ref={agentChatScrollRef}
                  className={styles.agentChatScroll}
                  aria-live="polite"
                  aria-relevant="additions"
                >
                  <StudioAgentChatMessageList
                    chatMessages={chatMessages}
                    loading={loading}
                    error={error}
                    thinkingStreamText={thinkingStreamText}
                    latestVersionInChat={latestVersionInChat}
                    promptDoneFullDiffMsgId={promptDoneFullDiffMsgId}
                    setPromptDoneFullDiffMsgId={setPromptDoneFullDiffMsgId}
                    handleEditPreviewApply={handleEditPreviewApply}
                    handleEditPreviewCancel={handleEditPreviewCancel}
                    setVersionRestoreConfirm={setVersionRestoreConfirm}
                    hoveredPromptSuggestion={hoveredPromptSuggestion}
                    setHoveredPromptSuggestion={setHoveredPromptSuggestion}
                    handleGenerate={handleGenerate}
                    result={result}
                    promptType={promptType}
                    setSkillSandboxLog={setSkillSandboxLog}
                    setSkillSandboxInput={setSkillSandboxInput}
                    setSkillSandboxOpen={setSkillSandboxOpen}
                    skillTestRunning={skillTestRunning}
                    skillTestResults={skillTestResults}
                    runSkillTestCases={runSkillTestCases}
                    prePromptForceContinue={prePromptForceContinue}
                  />
                </div>
              </div>
              <StudioAgentComposer
                result={result}
                loading={loading}
                suggestedActions={suggestedActions}
                suggestionsBarExpanded={suggestionsBarExpanded}
                setSuggestionsBarExpanded={setSuggestionsBarExpanded}
                handleSuggestedActionClick={handleSuggestedActionClick}
                questionFollowupOpen={questionFollowupOpen}
                setQuestionFollowupOpen={setQuestionFollowupOpen}
                renderQuestionsPanel={renderQuestionsPanel}
                chatInput={chatInput}
                setChatInput={setChatInput}
                handleAgentSend={handleAgentSend}
                agentChatPlaceholder={agentChatPlaceholder}
                activeLevelBundle={activeLevelBundle}
                tier={tier}
                setTier={setTier}
                setUseCustomGenModel={setUseCustomGenModel}
                genModel={genModel}
                genModelSelectOptions={genModelSelectOptions}
                setGenModel={setGenModel}
                workspaces={workspaces}
                workspaceId={workspaceId}
                setWorkspaceId={setWorkspaceId}
                workspacesReady={workspacesReady}
                promptType={promptType}
                imagePresetId={imagePresetId}
                imagePresetSelectOptions={imagePresetSelectOptions}
                setImagePresetId={setImagePresetId}
                skillPresetId={skillPresetId}
                skillPresetSelectOptions={skillPresetSelectOptions}
                setSkillPresetId={setSkillPresetId}
                skillTargetEnv={skillTargetEnv}
                skillTargetEnvSelectOptions={skillTargetEnvSelectOptions}
                setSkillTargetEnv={setSkillTargetEnv}
                targetModel={targetModel}
                targetModelSelectOptions={targetModelSelectOptions}
                setTargetModel={setTargetModel}
                techniqueMode={techniqueMode}
                setTechniqueMode={setTechniqueMode}
                expertLevel={expertLevel}
                manualTechPickerCollapsed={manualTechPickerCollapsed}
                setManualTechPickerCollapsed={setManualTechPickerCollapsed}
                manualTechHintDismissed={manualTechHintDismissed}
                setManualTechHintDismissed={setManualTechHintDismissed}
                showAdvanced={showAdvanced}
                setShowAdvanced={setShowAdvanced}
                techniques={techniques}
                techMenuFilter={techMenuFilter}
                setTechMenuFilter={setTechMenuFilter}
                manualTechs={manualTechs}
                setManualTechs={setManualTechs}
                temperature={temperature}
                setTemperature={setTemperature}
                topP={topP}
                setTopP={setTopP}
                topK={topK}
                setTopK={setTopK}
                questionsMode={questionsMode}
                setQuestionsMode={setQuestionsMode}
                skillBody={skillBody}
                setSkillBody={setSkillBody}
                localSkillsForPicker={localSkillsForPicker}
                skillInsertOpen={skillInsertOpen}
                setSkillInsertOpen={setSkillInsertOpen}
                skillInsertBtnRef={skillInsertBtnRef}
              />
            </div>`

let patched = home.slice(0, colStart) + replacement + home.slice(gutterStart)

// Find closing div of agentChatColumn - we need to remove duplicate - the replacement ends with </div> but old content had more closing divs before gutter
// Actually we sliced from colStart to gutterStart - gutter is AFTER column closes. Good.

// Replace {resultSection} with StudioResultPanel
patched = patched.replace(
  '{resultSection}',
  `<StudioResultPanel
              promptType={promptType}
              result={result}
              error={error}
              loading={loading}
              issueBannerDismissed={issueBannerDismissed}
              setIssueBannerDismissed={setIssueBannerDismissed}
              handleRetryGeneration={handleRetryGeneration}
              streamedPromptIde={streamedPromptIde}
              tokenEstimate={tokenEstimate}
              promptCostStr={promptCostStr}
              navigate={navigate}
              taskInput={taskInput}
              taskRefForTitles={taskRefForTitles}
              setChatInput={setChatInput}
              showSaveDialog={showSaveDialog}
              setShowSaveDialog={setShowSaveDialog}
              saveTitle={saveTitle}
              setSaveTitle={setSaveTitle}
              saveTags={saveTags}
              setSaveTags={setSaveTags}
              saveNotes={saveNotes}
              setSaveNotes={setSaveNotes}
              saveLibraryTarget={saveLibraryTarget}
              setSaveLibraryTarget={setSaveLibraryTarget}
              saveExistingLibraryId={saveExistingLibraryId}
              setSaveExistingLibraryId={setSaveExistingLibraryId}
              saveVersionAction={saveVersionAction}
              setSaveVersionAction={setSaveVersionAction}
              librarySaveOptions={librarySaveOptions}
              handleSaveToLibrary={handleSaveToLibrary}
              handleQuickSave={handleQuickSave}
              versions={versions}
              sessionId={sessionId}
              setResult={setResult}
              mergeSessionVersionIntoResult={mergeSessionVersionIntoResult}
              imageTryDataUrl={imageTryDataUrl}
              imageTryBusy={imageTryBusy}
              runImageTryNano={runImageTryNano}
              llmReviewBusy={llmReviewBusy}
              runLlmReview={runLlmReview}
              setPublishCommunityOpen={setPublishCommunityOpen}
              publishCommunityHintVisible={publishCommunityHintVisible}
              setPublishCommunityHintVisible={setPublishCommunityHintVisible}
              quickSaved={quickSaved}
              pickPromptTitle={pickPromptTitle}
              setPromptPlaygroundLog={setPromptPlaygroundLog}
              setPromptPlaygroundInput={setPromptPlaygroundInput}
              setPromptPlaygroundOpen={setPromptPlaygroundOpen}
            />`,
)

// Replace llmReview portal block
const llmStart = patched.indexOf('{llmReviewOpen')
const llmEnd = patched.indexOf(': null}', llmStart)
if (llmStart >= 0 && llmEnd >= 0) {
  const llmEndFull = llmEnd + ': null}'.length
  patched =
    patched.slice(0, llmStart) +
    `<StudioLlmReviewDock
        llmReviewOpen={llmReviewOpen}
        llmReviewMaximized={llmReviewMaximized}
        setLlmReviewMaximized={setLlmReviewMaximized}
        setLlmReviewOpen={setLlmReviewOpen}
        llmReviewBusy={llmReviewBusy}
        llmReviewThinkingLine={llmReviewThinkingLine}
        llmReviewModel={llmReviewModel}
        llmReviewFromCache={llmReviewFromCache}
        streamedLlmReviewBody={streamedLlmReviewBody}
        llmReviewText={llmReviewText}
        llmReviewHints={llmReviewHints}
        llmReviewHintsOpen={llmReviewHintsOpen}
        setLlmReviewHintsOpen={setLlmReviewHintsOpen}
        loading={loading}
        setChatInput={setChatInput}
        runLlmReview={runLlmReview}
      />` +
    patched.slice(llmEndFull)
}

// Fix tags -> div in replacement
patched = patched.replaceAll('<div ', '<div ').replaceAll('</div>', '</div>')

fs.writeFileSync(homePath, patched, 'utf8')
console.log('patched Home.tsx', patched.split('\n').length, 'lines')
