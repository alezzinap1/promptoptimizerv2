import { useEffect, useMemo, useState } from 'react'
import MarkdownOutput from '../../components/MarkdownOutput'
import { CopyIconButton, DownloadIconButton, PencilIconButton, TrashIconButton } from '../../components/PromptToolbarIcons'
import styles from './SkillsPanel.module.css'

const STORAGE_KEY = 'prompt-engineer-skills-v1'

export type SkillItem = {
  id: string
  title: string
  description: string
  frameworks: string[]
  body: string
  createdAt: string
}

function loadSkills(): SkillItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const p = JSON.parse(raw)
    return Array.isArray(p) ? p : []
  } catch {
    return []
  }
}

function saveSkills(items: SkillItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

const emptyDraft = {
  title: '',
  description: '',
  frameworks: '',
  body: '',
}

export default function SkillsPanel() {
  const [items, setItems] = useState<SkillItem[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    setItems(loadSkills())
  }, [])

  const persist = (next: SkillItem[]) => {
    setItems(next)
    saveSkills(next)
  }

  const openCreate = () => {
    setEditingId(null)
    setDraft(emptyDraft)
    setShowModal(true)
  }

  const openEdit = (item: SkillItem) => {
    setEditingId(item.id)
    setDraft({
      title: item.title,
      description: item.description,
      frameworks: item.frameworks.join(', '),
      body: item.body,
    })
    setShowModal(true)
  }

  const submit = () => {
    const title = draft.title.trim()
    const body = draft.body.trim()
    if (!title || !body) return
    const frameworks = draft.frameworks
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (editingId) {
      persist(
        items.map((it) =>
          it.id === editingId
            ? {
                ...it,
                title,
                description: draft.description.trim(),
                frameworks,
                body,
              }
            : it,
        ),
      )
    } else {
      const id = `sk_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
      persist([
        ...items,
        {
          id,
          title,
          description: draft.description.trim(),
          frameworks,
          body,
          createdAt: new Date().toISOString(),
        },
      ])
    }
    setShowModal(false)
    setDraft(emptyDraft)
    setEditingId(null)
  }

  const remove = (id: string) => {
    persist(items.filter((it) => it.id !== id))
  }

  const exportAll = useMemo(() => {
    return items
      .map(
        (it) =>
          `# ${it.title}\nFrameworks: ${it.frameworks.join(', ')}\n\n${it.description}\n\n---\n\n${it.body}`,
      )
      .join('\n\n' + '='.repeat(48) + '\n\n')
  }, [items])

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <h2 className="pageTitleGradient">Скиллы</h2>
        <p className={styles.lead}>
          Наборы инструкций и сценариев для агентных пайплайнов (LangGraph, CrewAI, AutoGen и т.д.). Хранятся локально в
          браузере.
        </p>
      </div>

      <div className={styles.toolbar}>
        <button type="button" className={`${styles.primary} btn-primary`} onClick={openCreate}>
          Новый скилл
        </button>
        {items.length > 0 ? (
          <button
            type="button"
            className={`${styles.export} btn-ghost`}
            title="Скачать один .txt со всеми скиллами"
            onClick={() => {
              const blob = new Blob([exportAll], { type: 'text/plain;charset=utf-8' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = 'skills_export.txt'
              a.click()
              URL.revokeObjectURL(url)
            }}
          >
            Экспорт всех
          </button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className={styles.empty}>Пока нет скиллов — добавьте первый набор инструкций для вашего агента.</p>
      ) : (
        <div className={styles.grid}>
          {items.map((it) => (
            <div key={it.id} className={styles.card}>
              <h3>{it.title}</h3>
              {it.description ? <p className={styles.desc}>{it.description}</p> : null}
              {it.frameworks.length > 0 ? (
                <div className={styles.tags}>
                  {it.frameworks.map((f) => (
                    <span key={f} className={styles.tag}>
                      {f}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className={styles.previewBox}>
                <MarkdownOutput className={styles.mdClamp}>
                  {it.body.length > 1200 ? `${it.body.slice(0, 1200)}\n\n…` : it.body}
                </MarkdownOutput>
              </div>
              <div className={styles.actions}>
                <CopyIconButton text={it.body} title="Копировать тело скилла" />
                <DownloadIconButton
                  title="Скачать скилл как .txt"
                  onClick={() => {
                    const text = `${it.title}\n\n${it.description}\n\nФреймворки: ${it.frameworks.join(', ')}\n\n${it.body}`
                    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `skill_${it.id}.txt`
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                />
                <PencilIconButton title="Редактировать" onClick={() => openEdit(it)} />
                <TrashIconButton title="Удалить скилл" onClick={() => remove(it.id)} />
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className={styles.modalOverlay} onClick={() => setShowModal(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3>{editingId ? 'Редактировать скилл' : 'Новый скилл'}</h3>
            <label className={styles.field}>
              Название
              <input
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="Например: Исследование рынка"
              />
            </label>
            <label className={styles.field}>
              Краткое описание
              <textarea
                rows={2}
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="Зачем этот скилл и когда его вызывать"
              />
            </label>
            <label className={styles.field}>
              Совместимые фреймворки (через запятую)
              <input
                value={draft.frameworks}
                onChange={(e) => setDraft((d) => ({ ...d, frameworks: e.target.value }))}
                placeholder="LangGraph, CrewAI, OpenAI Agents…"
              />
            </label>
            <label className={styles.field}>
              Тело скилла (Markdown)
              <textarea
                rows={12}
                className={styles.bodyInput}
                value={draft.body}
                onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                placeholder="Инструкции, шаги, формат вывода, ограничения…"
              />
            </label>
            <div className={styles.modalActions}>
              <button
                type="button"
                className="btn-primary"
                onClick={submit}
                disabled={!draft.title.trim() || !draft.body.trim()}
              >
                {editingId ? 'Сохранить' : 'Добавить'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
