import { useEffect, useState } from 'react'
import { api, type Workspace } from '../api/client'
import styles from './Workspaces.module.css'

const ACTIVE_WORKSPACE_KEY = 'prompt-engineer-active-workspace'

const WORKSPACE_FIELDS = [
  { key: 'name', label: 'Название', placeholder: 'Например: Fintech analytics', help: 'Короткое имя workspace для выбора в Home.' },
  { key: 'description', label: 'Описание', placeholder: 'Что хранит этот workspace', help: 'Человеческое описание сценария и контекста.' },
  { key: 'glossary', label: 'Глоссарий', placeholder: 'Один термин на строку', help: 'Термины и определения проекта, которые нужно учитывать в prompt.' },
  { key: 'style_rules', label: 'Style rules', placeholder: 'Одно правило на строку', help: 'Тон, стиль, форматирование и editorial-правила.' },
  { key: 'default_constraints', label: 'Default constraints', placeholder: 'Одно ограничение на строку', help: 'Ограничения, которые должны автоматически попадать в prompt.' },
  { key: 'reference_snippets', label: 'Reference snippets', placeholder: 'Один snippet на строку', help: 'Фрагменты, примеры или опорные куски контекста.' },
] as const

function splitLines(value: string) {
  return value.split('\n').map((v) => v.trim()).filter(Boolean)
}

export default function Workspaces() {
  const [items, setItems] = useState<Workspace[]>([])
  const [activeId, setActiveId] = useState<number>(Number(localStorage.getItem(ACTIVE_WORKSPACE_KEY) || 0))
  const [error, setError] = useState<string | null>(null)
  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    glossary: '',
    style_rules: '',
    default_constraints: '',
    reference_snippets: '',
  })
  const [editing, setEditing] = useState<Record<number, typeof createForm>>({})

  const load = () => {
    api.getWorkspaces()
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'))
  }

  useEffect(() => {
    load()
  }, [])

  const createWorkspace = async () => {
    await api.createWorkspace({
      ...createForm,
      glossary: splitLines(createForm.glossary),
      style_rules: splitLines(createForm.style_rules),
      default_constraints: splitLines(createForm.default_constraints),
      reference_snippets: splitLines(createForm.reference_snippets),
    })
    setCreateForm({
      name: '',
      description: '',
      glossary: '',
      style_rules: '',
      default_constraints: '',
      reference_snippets: '',
    })
    load()
  }

  const renderField = (
    form: typeof createForm,
    onChange: (key: keyof typeof createForm, value: string) => void,
  ) => (
    <div className={styles.formGrid}>
      {WORKSPACE_FIELDS.map((field) => {
        const isTextarea = ['description', 'glossary', 'style_rules', 'default_constraints', 'reference_snippets'].includes(field.key)
        return (
          <label key={field.key} className={styles.formField}>
            <span className={styles.labelRow}>
              <span>{field.label}</span>
              <span className={styles.helpIcon} title={field.help}>?</span>
            </span>
            {isTextarea ? (
              <textarea
                rows={field.key === 'description' ? 3 : 4}
                placeholder={field.placeholder}
                value={form[field.key]}
                onChange={(e) => onChange(field.key, e.target.value)}
              />
            ) : (
              <input
                placeholder={field.placeholder}
                value={form[field.key]}
                onChange={(e) => onChange(field.key, e.target.value)}
              />
            )}
          </label>
        )
      })}
    </div>
  )

  const [showCreateModal, setShowCreateModal] = useState(false)

  return (
    <div className={styles.page}>
      <h1>Workspaces</h1>
      <p className={styles.caption}>
        Workspace — это контекст проекта: правила, глоссарий, ограничения и примеры. Выберите workspace при генерации промптов.
      </p>
      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.toolbar}>
        <button className={styles.createBtn} onClick={() => setShowCreateModal(true)}>
          Создать workspace
        </button>
      </div>

      {showCreateModal && (
        <div className={styles.modalOverlay} onClick={() => setShowCreateModal(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>Новый workspace</h3>
              <button className={styles.modalClose} onClick={() => setShowCreateModal(false)}>×</button>
            </div>
            <div className={styles.form}>
              {renderField(createForm, (key, value) => setCreateForm((prev) => ({ ...prev, [key]: value })))}
              <button className={styles.primaryBtn} onClick={async () => {
                await createWorkspace()
                setShowCreateModal(false)
              }}>Создать</button>
            </div>
          </div>
        </div>
      )}

      <div className={styles.grid}>
        {items.map((workspace) => {
          const cfg = workspace.config || {}
          const form = editing[workspace.id || 0] || {
            name: workspace.name,
            description: workspace.description,
            glossary: (cfg.glossary || []).join('\n'),
            style_rules: (cfg.style_rules || []).join('\n'),
            default_constraints: (cfg.default_constraints || []).join('\n'),
            reference_snippets: (cfg.reference_snippets || []).join('\n'),
          }
          return (
            <div key={workspace.id || workspace.name} className={styles.card}>
              <div className={styles.cardHeader}>
                <div>
                  <h3>{workspace.name}</h3>
                  <p>{workspace.description}</p>
                </div>
                <button onClick={() => {
                  localStorage.setItem(ACTIVE_WORKSPACE_KEY, String(workspace.id || 0))
                  setActiveId(Number(workspace.id || 0))
                }}>
                  {activeId === workspace.id ? 'Активен' : 'Активировать'}
                </button>
              </div>

              <div className={styles.metrics}>
                <span>Glossary: {(cfg.glossary || []).length}</span>
                <span>Constraints: {(cfg.default_constraints || []).length}</span>
                <span>Refs: {(cfg.reference_snippets || []).length}</span>
              </div>

              <details>
                <summary>Редактировать workspace</summary>
                <div className={styles.form}>
                  {renderField(
                    form,
                    (key, value) => setEditing((prev) => ({ ...prev, [workspace.id || 0]: { ...form, [key]: value } })),
                  )}
                  <div className={styles.actions}>
                    <button onClick={async () => {
                      await api.updateWorkspace(workspace.id || 0, {
                        name: form.name,
                        description: form.description,
                        glossary: splitLines(form.glossary),
                        style_rules: splitLines(form.style_rules),
                        default_constraints: splitLines(form.default_constraints),
                        reference_snippets: splitLines(form.reference_snippets),
                      })
                      load()
                    }}>Сохранить</button>
                    <button onClick={async () => {
                      await api.deleteWorkspace(workspace.id || 0)
                      if (activeId === workspace.id) {
                        localStorage.setItem(ACTIVE_WORKSPACE_KEY, '0')
                        setActiveId(0)
                      }
                      load()
                    }}>Удалить</button>
                  </div>
                </div>
              </details>
            </div>
          )
        })}
      </div>
    </div>
  )
}
