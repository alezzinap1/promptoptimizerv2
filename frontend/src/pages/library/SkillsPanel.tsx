import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import LibraryTagChips from '../../components/LibraryTagChips'
import MarkdownOutput from '../../components/MarkdownOutput'
import { CopyIconButton, DownloadIconButton, PencilIconButton, TrashIconButton } from '../../components/PromptToolbarIcons'
import PublishToCommunityModal from '../../components/PublishToCommunityModal'
import SelectDropdown from '../../components/SelectDropdown'
import { loadLocalSkills, saveLocalSkills, type SkillItem } from '../../lib/localSkillsStore'
import libStyles from '../Library.module.css'
import styles from './SkillsPanel.module.css'

export type { SkillItem }

const emptyDraft = {
  title: '',
  description: '',
  frameworks: '',
  tags: '',
  body: '',
}

type SkillsPanelProps = {
  /** При уходе со вкладки «Скиллы» в хабе — закрыть модалку создания */
  libraryActiveTab?: 'prompts' | 'techniques' | 'skills'
  onCountChange?: (n: number) => void
  gridCols?: 3 | 4
}

function matchesSearch(item: SkillItem, q: string): boolean {
  if (!q.trim()) return true
  const n = q.trim().toLowerCase()
  const blob = [item.title, item.description, item.body, ...item.frameworks, ...item.tags].join(' ').toLowerCase()
  return blob.includes(n)
}

export default function SkillsPanel({ libraryActiveTab, onCountChange, gridCols = 3 }: SkillsPanelProps) {
  const navigate = useNavigate()
  const [items, setItems] = useState<SkillItem[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'date' | 'name'>('date')
  const [tagPaintTick, setTagPaintTick] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [genDescription, setGenDescription] = useState('')
  const [publishSkill, setPublishSkill] = useState<SkillItem | null>(null)

  const handleGenerate = useCallback(async () => {
    const desc = genDescription.trim()
    if (!desc) return
    setGenerating(true)
    try {
      const r = await api.generateSkill(desc)
      if (r.generated_body) {
        const lines = r.generated_body.split('\n')
        let name = desc.slice(0, 60)
        const nameLine = lines.find((l) => l.startsWith('name:'))
        if (nameLine) name = nameLine.replace('name:', '').trim()
        const descLine = lines.find((l) => l.startsWith('description:'))
        const genDesc = descLine ? descLine.replace('description:', '').trim() : ''
        const bodyStart = r.generated_body.indexOf('---', r.generated_body.indexOf('---') + 1)
        const body = bodyStart > 0 ? r.generated_body.slice(bodyStart + 3).trim() : r.generated_body
        setDraft((d) => ({ ...d, title: d.title || name, description: d.description || genDesc, body }))
      }
    } catch { /* ignore */ }
    setGenerating(false)
  }, [genDescription])

  useEffect(() => {
    const onPaint = () => setTagPaintTick((t) => t + 1)
    window.addEventListener('metaprompt-tag-accent-changed', onPaint)
    return () => window.removeEventListener('metaprompt-tag-accent-changed', onPaint)
  }, [])

  useEffect(() => {
    setItems(loadLocalSkills())
  }, [])

  useEffect(() => {
    const sync = () => setItems(loadLocalSkills())
    window.addEventListener('metaprompt-nav-refresh', sync)
    return () => window.removeEventListener('metaprompt-nav-refresh', sync)
  }, [])

  useEffect(() => {
    onCountChange?.(items.length)
  }, [items.length, onCountChange])

  useEffect(() => {
    if (libraryActiveTab === undefined) return
    if (libraryActiveTab !== 'skills') {
      setShowModal(false)
      setEditingId(null)
    }
  }, [libraryActiveTab])

  const filtered = useMemo(() => items.filter((it) => matchesSearch(it, search)), [items, search])

  const sortOptions = useMemo(() => [
    { value: 'date', label: 'По дате' },
    { value: 'name', label: 'По имени' },
  ], [])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    if (sortBy === 'name') return arr.sort((a, b) => a.title.localeCompare(b.title))
    return arr.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  }, [filtered, sortBy])

  const persist = (next: SkillItem[]) => {
    setItems(next)
    saveLocalSkills(next)
    window.dispatchEvent(new CustomEvent('metaprompt-nav-refresh'))
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
      tags: item.tags.join(', '),
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
    const tags = draft.tags
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
                tags,
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
          tags,
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

  const gridClass = gridCols === 4 ? styles.grid4 : styles.grid3
  const chipTags = (it: SkillItem) => [...it.tags, ...it.frameworks]

  return (
    <div className={libStyles.library}>
      <p className={styles.leadCompact}>
        Скиллы хранятся локально в браузере. Теги участвуют в поиске; цвет тега — по нажатию на чип.
      </p>

      <div className={`${styles.toolbar} ${styles.toolbarCompact}`}>
        <button type="button" className={`${styles.primary} ${styles.primarySmall} btn-primary`} onClick={openCreate}>
          + Скилл
        </button>
        <input
          type="search"
          className={styles.search}
          placeholder="Поиск по тексту, тегам, фреймворкам…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <SelectDropdown
          value={sortBy}
          options={sortOptions}
          onChange={(v) => setSortBy(v as 'date' | 'name')}
          aria-label="Сортировка"
          variant="toolbar"
          className={styles.sortSelect}
        />
      </div>

      {items.length === 0 ? (
        <p className={styles.empty}>Пока нет скиллов — добавьте первый набор инструкций.</p>
      ) : filtered.length === 0 ? (
        <p className={styles.empty}>Ничего не найдено — измените запрос.</p>
      ) : (
        <div key={tagPaintTick} className={`${styles.grid} ${gridClass}`}>
          {sorted.map((it) => (
            <div key={it.id} className={styles.card}>
              <h3>{it.title}</h3>
              {it.description ? <p className={styles.desc}>{it.description}</p> : null}
              {chipTags(it).length > 0 ? <LibraryTagChips tags={chipTags(it)} /> : null}
              <div className={styles.previewBox}>
                <MarkdownOutput className={styles.mdClamp}>
                  {it.body.length > 1200 ? `${it.body.slice(0, 1200)}\n\n…` : it.body}
                </MarkdownOutput>
              </div>
              <div className={styles.actions}>
                <CopyIconButton text={it.body} title="Копировать тело скилла" />
                <button
                  type="button"
                  className={styles.pubBtn}
                  title="Опубликовать в сообществе"
                  onClick={() => setPublishSkill(it)}
                >
                  Сообщество
                </button>
                <DownloadIconButton
                  title="Скачать скилл как .txt"
                  onClick={() => {
                    const text = `${it.title}\n\n${it.description}\n\nТеги: ${it.tags.join(', ')}\nФреймворки: ${it.frameworks.join(', ')}\n\n${it.body}`
                    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `skill_${it.id}.txt`
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                />
                <button
                  type="button"
                  className={styles.forkBtn}
                  title="Открыть в студии (вкладка Скилл)"
                  onClick={() =>
                    navigate('/', {
                      state: { studioForkSkill: { body: it.body, title: it.title } },
                    })
                  }
                >
                  Форк
                </button>
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
            {!editingId && (
              <div className={styles.field} style={{ background: 'var(--panel-strong)', padding: 10, borderRadius: 8 }}>
                <label style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: 4, display: 'block' }}>
                  Сгенерировать с помощью ИИ
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={genDescription}
                    onChange={(e) => setGenDescription(e.target.value)}
                    placeholder="Опишите скилл: SEO-эксперт для блогов…"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleGenerate}
                    disabled={generating || !genDescription.trim()}
                    style={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }}
                  >
                    {generating ? 'Генерация…' : 'Сгенерировать'}
                  </button>
                </div>
              </div>
            )}
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
                placeholder="Зачем этот скилл"
              />
            </label>
            <label className={styles.field}>
              Теги (через запятую)
              <input
                value={draft.tags}
                onChange={(e) => setDraft((d) => ({ ...d, tags: e.target.value }))}
                placeholder="research, rag, api…"
              />
            </label>
            <label className={styles.field}>
              Фреймворки (через запятую)
              <input
                value={draft.frameworks}
                onChange={(e) => setDraft((d) => ({ ...d, frameworks: e.target.value }))}
                placeholder="LangGraph, CrewAI…"
              />
            </label>
            <label className={styles.field}>
              Тело скилла (Markdown)
              <textarea
                rows={12}
                className={styles.bodyInput}
                value={draft.body}
                onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                placeholder="Инструкции, шаги, формат вывода…"
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

      {publishSkill && (
        <PublishToCommunityModal
          open
          onClose={() => setPublishSkill(null)}
          initial={{
            title: publishSkill.title,
            prompt: publishSkill.body,
            description: publishSkill.description,
            prompt_type: 'skill',
            tags: [...publishSkill.tags, ...publishSkill.frameworks],
          }}
        />
      )}
    </div>
  )
}
