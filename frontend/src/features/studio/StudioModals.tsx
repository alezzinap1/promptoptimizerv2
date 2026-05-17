import { createPortal } from 'react-dom'
import type { Dispatch, SetStateAction } from 'react'
import type { GenerateResult } from '../../api/client'
import AutoTextarea from '../../components/AutoTextarea'
import LibraryPickButton from '../../components/LibraryPickButton'
import { StreamedMarkdownOutput } from '../../lib/simulatedLlmStream'
import { mergeSessionVersionIntoResult } from './homeHelpers'
import type { StudioSandboxLogRow } from './studioUiTypes'
import styles from '../../pages/Home.module.css'

export type StudioVersionRestoreConfirm = { version: number; prompt: string }

export type StudioModalsProps = {
  versionRestoreConfirm: StudioVersionRestoreConfirm | null
  setVersionRestoreConfirm: Dispatch<SetStateAction<StudioVersionRestoreConfirm | null>>
  versions: unknown[]
  sessionId: string | null
  result: GenerateResult | null
  setResult: Dispatch<SetStateAction<GenerateResult | null>>
  promptPlaygroundOpen: boolean
  setPromptPlaygroundOpen: Dispatch<SetStateAction<boolean>>
  promptPlaygroundBusy: boolean
  promptPlaygroundThinkingLine: string
  promptPlaygroundLog: StudioSandboxLogRow[]
  promptPlaygroundInput: string
  setPromptPlaygroundInput: Dispatch<SetStateAction<string>>
  onSendPromptPlayground: () => void | Promise<void>
  skillSandboxOpen: boolean
  setSkillSandboxOpen: Dispatch<SetStateAction<boolean>>
  skillSandboxBusy: boolean
  skillSandboxThinkingLine: string
  skillSandboxLog: StudioSandboxLogRow[]
  skillSandboxInput: string
  setSkillSandboxInput: Dispatch<SetStateAction<string>>
  onSendSkillSandbox: () => void | Promise<void>
}

export function StudioModals({
  versionRestoreConfirm,
  setVersionRestoreConfirm,
  versions,
  sessionId,
  result,
  setResult,
  promptPlaygroundOpen,
  setPromptPlaygroundOpen,
  promptPlaygroundBusy,
  promptPlaygroundThinkingLine,
  promptPlaygroundLog,
  promptPlaygroundInput,
  setPromptPlaygroundInput,
  onSendPromptPlayground,
  skillSandboxOpen,
  setSkillSandboxOpen,
  skillSandboxBusy,
  skillSandboxThinkingLine,
  skillSandboxLog,
  skillSandboxInput,
  setSkillSandboxInput,
  onSendSkillSandbox,
}: StudioModalsProps) {
  return (
    <>
      {versionRestoreConfirm ? (
        <div
          className={styles.versionRestoreBackdrop}
          role="dialog"
          aria-modal="true"
          aria-labelledby="version-restore-title"
        >
          <div className={styles.versionRestoreBox}>
            <h3 id="version-restore-title" className={styles.versionRestoreTitle}>
              Перейти к версии v{versionRestoreConfirm.version}?
            </h3>
            <p className={styles.versionRestoreText}>
              Текст промпта справа заменится на сохранённую версию из чата. Продолжить?
            </p>
            <div className={styles.versionRestoreActions}>
              <button
                type="button"
                className={`${styles.primaryAction} btn-primary`}
                onClick={() => {
                  const { version: ver, prompt: snap } = versionRestoreConfirm
                  const row = versions.find(
                    (it) => Number((it as Record<string, unknown>).version) === ver,
                  ) as Record<string, unknown> | undefined
                  const sid = (sessionId || result?.session_id || '').trim()
                  setResult((prev) => {
                    if (!prev) return prev
                    if (row && sid) return mergeSessionVersionIntoResult(prev, row, sid)
                    return { ...prev, prompt_block: snap }
                  })
                  setVersionRestoreConfirm(null)
                }}
              >
                Да, перейти
              </button>
              <button type="button" className="btn-ghost" onClick={() => setVersionRestoreConfirm(null)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {promptPlaygroundOpen
        ? createPortal(
            <div className={styles.skillSandboxBackdrop} role="presentation">
              <div
                className={`${styles.skillSandboxModal} ${styles.skillSandboxModalPrompt}`}
                role="dialog"
                aria-modal="true"
                aria-label="Песочница промпта"
              >
                <div className={styles.skillSandboxHead}>
                  <h3 className={styles.skillSandboxTitle}>Песочница промпта</h3>
                  <button
                    type="button"
                    className={styles.skillSandboxClose}
                    disabled={promptPlaygroundBusy}
                    onClick={() => setPromptPlaygroundOpen(false)}
                  >
                    ×
                  </button>
                </div>
                <p className={styles.skillSandboxHint}>Системный контекст = текущий промпт справа.</p>
                <div className={styles.skillSandboxLog}>
                  {promptPlaygroundBusy && promptPlaygroundThinkingLine ? (
                    <div className={styles.auxThinkingLine} aria-live="polite">
                      <span className={styles.auxThinkingDots} aria-hidden>
                        <span />
                        <span />
                        <span />
                      </span>
                      <span>{promptPlaygroundThinkingLine}</span>
                    </div>
                  ) : null}
                  {promptPlaygroundLog.length === 0 && !promptPlaygroundBusy ? (
                    <p className={styles.skillSandboxEmpty}>Напишите тестовый ввод ниже.</p>
                  ) : (
                    promptPlaygroundLog.map((row, i) => (
                      <div
                        key={i}
                        className={
                          row.role === 'user' ? styles.skillSandboxRowUser : styles.skillSandboxRowAsst
                        }
                      >
                        <StreamedMarkdownOutput source={row.content} suspend={row.role === 'user'} />
                      </div>
                    ))
                  )}
                </div>
                <div className={styles.skillSandboxComposer}>
                  <div className={styles.skillSandboxPickRow}>
                    <LibraryPickButton
                      applyMode="user_turn"
                      onApply={setPromptPlaygroundInput}
                      disabled={promptPlaygroundBusy}
                    />
                  </div>
                  <div className={styles.skillSandboxComposerRow}>
                    <AutoTextarea
                      className={styles.skillSandboxTextarea}
                      value={promptPlaygroundInput}
                      onChange={(e) => setPromptPlaygroundInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          if (!promptPlaygroundBusy && promptPlaygroundInput.trim()) void onSendPromptPlayground()
                        }
                      }}
                      minHeightPx={44}
                      maxHeightPx={120}
                      placeholder="Тестовый ввод (как от пользователя)…"
                    />
                    <button
                      type="button"
                      className={styles.skillSandboxSend}
                      disabled={
                        promptPlaygroundBusy || !promptPlaygroundInput.trim() || !result?.prompt_block?.trim()
                      }
                      onClick={() => void onSendPromptPlayground()}
                    >
                      {promptPlaygroundBusy ? '…' : 'Отправить'}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      {skillSandboxOpen
        ? createPortal(
            <div className={styles.skillSandboxBackdrop} role="presentation">
              <div
                className={`${styles.skillSandboxModal} ${styles.skillSandboxModalSkill}`}
                role="dialog"
                aria-modal="true"
                aria-label="Песочница скилла"
              >
                <div className={styles.skillSandboxHead}>
                  <h3 className={styles.skillSandboxTitle}>Песочница скилла</h3>
                  <button
                    type="button"
                    className={styles.skillSandboxClose}
                    disabled={skillSandboxBusy}
                    onClick={() => setSkillSandboxOpen(false)}
                  >
                    ×
                  </button>
                </div>
                <p className={styles.skillSandboxBanner}>Диалог со скиллом как с системным промптом — не «оценка».</p>
                <p className={styles.skillSandboxHint}>
                  Один раунд: системный контекст = текущий промпт-скилл справа. Сообщения не сохраняются на
                  сервере.
                </p>
                <div className={styles.skillSandboxLog}>
                  {skillSandboxBusy && skillSandboxThinkingLine ? (
                    <div className={styles.auxThinkingLine} aria-live="polite">
                      <span className={styles.auxThinkingDots} aria-hidden>
                        <span />
                        <span />
                        <span />
                      </span>
                      <span>{skillSandboxThinkingLine}</span>
                    </div>
                  ) : null}
                  {skillSandboxLog.length === 0 && !skillSandboxBusy ? (
                    <p className={styles.skillSandboxEmpty}>Напишите сообщение ниже.</p>
                  ) : (
                    skillSandboxLog.map((row, i) => (
                      <div
                        key={i}
                        className={
                          row.role === 'user' ? styles.skillSandboxRowUser : styles.skillSandboxRowAsst
                        }
                      >
                        <StreamedMarkdownOutput source={row.content} suspend={row.role === 'user'} />
                      </div>
                    ))
                  )}
                </div>
                <div className={styles.skillSandboxComposer}>
                  <div className={styles.skillSandboxPickRow}>
                    <LibraryPickButton
                      applyMode="user_turn"
                      onApply={setSkillSandboxInput}
                      disabled={skillSandboxBusy}
                    />
                  </div>
                  <div className={styles.skillSandboxComposerRow}>
                    <AutoTextarea
                      className={styles.skillSandboxTextarea}
                      value={skillSandboxInput}
                      onChange={(e) => setSkillSandboxInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          if (!skillSandboxBusy && skillSandboxInput.trim()) void onSendSkillSandbox()
                        }
                      }}
                      minHeightPx={44}
                      maxHeightPx={120}
                      placeholder="Сообщение для модели…"
                    />
                    <button
                      type="button"
                      className={styles.skillSandboxSend}
                      disabled={skillSandboxBusy || !skillSandboxInput.trim()}
                      onClick={() => void onSendSkillSandbox()}
                    >
                      {skillSandboxBusy ? '…' : 'Отправить'}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
