import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type LibraryItem } from '../../api/client'
import MarkdownOutput from '../MarkdownOutput'
import SimpleLineDiff from '../SimpleLineDiff'
import LibraryTagChips from '../LibraryTagChips'
import LibraryRevisionStrip from '../LibraryRevisionStrip'
import { CopyIconButton } from '../PromptToolbarIcons'
import TranslateButton from '../TranslateButton'
import { formatLibraryCardDates } from '../../lib/promptLibraryMeta'
import { libraryUserTurnFromCard } from '../../lib/libraryPickText'
import { useT } from '../../i18n'
import styles from './LibraryPromptDrawer.module.css'

type Props = {
  item: LibraryItem | null
  open: boolean
  onClose: () => void
  onDeleted?: (id: number) => void
  onUpdated?: (item: LibraryItem) => void
}

export default function LibraryPromptDrawer({ item, open, onClose, onDeleted, onUpdated }: Props) {
  const navigate = useNavigate()
  const { t } = useT()
  const [tab, setTab] = useState<'body' | 'versions'>('body')
  const [diffRevId, setDiffRevId] = useState<number | null>(null)
  const [diffBefore, setDiffBefore] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setTab('body')
    setDiffRevId(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  const promptText = item?.prompt ?? ''

  useEffect(() => {
    if (!item || diffRevId == null) {
      setDiffBefore('')
      return
    }
    let cancelled = false
    api
      .getLibraryRevisions(item.id)
      .then((r) => {
        if (cancelled) return
        const rev = r.items.find((x) => x.id === diffRevId)
        setDiffBefore(rev?.prompt ?? '')
      })
      .catch(() => {
        if (!cancelled) setDiffBefore('')
      })
    return () => {
      cancelled = true
    }
  }, [item, diffRevId])

  if (!open || !item) return null

  const openInStudio = () => {
    navigate('/home', {
      state: { prefillTask: `Улучши этот промпт:\n\n${promptText}`, clearResult: true },
    })
    onClose()
  }

  const compareAsB = () => {
    navigate(
      { pathname: '/compare', search: '?mode=prompts' },
      {
        state: {
          prompts: { promptB: promptText, taskInput: libraryUserTurnFromCard(item) },
        },
      },
    )
    onClose()
  }

  const duplicate = async () => {
    setBusy(true)
    try {
      await api.saveToLibrary({
        title: `${item.title} (копия)`,
        prompt: promptText,
        tags: item.tags,
        task_type: item.task_type,
        notes: item.notes,
      })
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!window.confirm(t.library.drawer.confirmDelete)) return
    setBusy(true)
    try {
      await api.deleteLibrary(item.id)
      onDeleted?.(item.id)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const copyMarkdown = () => {
    const md = `# ${item.title}\n\n${promptText}`
    void navigator.clipboard.writeText(md)
  }

  const tok = Math.max(1, Math.round(promptText.length / 3.5))

  return (
    <div className={styles.root} role="presentation">
      <button type="button" className={styles.backdrop} aria-label={t.library.drawer.close} onClick={onClose} />
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="lib-drawer-title">
        <header className={styles.head}>
          <div>
            <h2 id="lib-drawer-title" className={styles.title}>
              {item.title}
            </h2>
            {item.created_at ? (
              <p className={styles.meta}>{formatLibraryCardDates(item.created_at, item.updated_at)}</p>
            ) : null}
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label={t.library.drawer.close}>
            ×
          </button>
        </header>

        <div className={styles.metaRow}>
          {item.target_model && item.target_model !== 'unknown' ? (
            <span className={styles.chip}>{item.target_model}</span>
          ) : null}
          <span className={styles.chip}>{item.task_type}</span>
          <span className={styles.chip}>
            {tok.toLocaleString()} tok · {(item.prompt_lang || 'ru').toUpperCase()}
          </span>
        </div>

        {item.tags.length > 0 ? <LibraryTagChips tags={item.tags} className={styles.tags} /> : null}

        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'body'}
            className={tab === 'body' ? styles.tabActive : styles.tab}
            onClick={() => setTab('body')}
          >
            {t.library.drawer.tabBody}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'versions'}
            className={tab === 'versions' ? styles.tabActive : styles.tab}
            onClick={() => setTab('versions')}
            disabled={!item.revisions?.length}
          >
            {t.library.drawer.tabVersions}
          </button>
        </div>

        <div className={styles.body}>
          {tab === 'body' ? (
            <div className={styles.markdown}>
              <MarkdownOutput>{promptText}</MarkdownOutput>
              <TranslateButton
                getValue={() => promptText}
                setValue={(v) => onUpdated?.({ ...item, prompt: v })}
                kind="prompt"
                title={t.library.drawer.translate}
              />
            </div>
          ) : (
            <div className={styles.versions}>
              {item.revisions && item.revisions.length > 0 ? (
                <>
                  <LibraryRevisionStrip
                    libraryId={item.id}
                    revisions={item.revisions}
                    onStarRevision={() => {}}
                  />
                  <label className={styles.diffLabel}>
                    {t.library.drawer.diffAgainst}
                    <select
                      className={styles.diffSelect}
                      value={diffRevId ?? ''}
                      onChange={(e) => setDiffRevId(e.target.value ? Number(e.target.value) : null)}
                    >
                      <option value="">{t.library.drawer.pickRevision}</option>
                      {item.revisions.map((r) => (
                        <option key={r.id} value={r.id}>
                          v{r.version_seq} · #{r.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  {diffRevId != null && diffBefore ? (
                    <SimpleLineDiff before={diffBefore} after={promptText} />
                  ) : null}
                </>
              ) : (
                <p className={styles.emptyVersions}>{t.library.drawer.noVersions}</p>
              )}
            </div>
          )}
        </div>

        <footer className={styles.footer}>
          <button type="button" className="btn-primary" onClick={openInStudio} disabled={busy}>
            {t.library.drawer.openStudio}
          </button>
          <button type="button" className="btn-secondary" onClick={compareAsB} disabled={busy}>
            {t.library.drawer.compareB}
          </button>
          <button type="button" className="btn-ghost" onClick={() => void duplicate()} disabled={busy}>
            {t.library.drawer.duplicate}
          </button>
          <CopyIconButton text={promptText} title={t.library.drawer.copy} />
          <button type="button" className="btn-ghost" onClick={copyMarkdown}>
            {t.library.drawer.copyMd}
          </button>
          <button type="button" className={styles.danger} onClick={() => void remove()} disabled={busy}>
            {t.library.drawer.delete}
          </button>
        </footer>
      </aside>
    </div>
  )
}
