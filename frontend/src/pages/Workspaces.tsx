import { useEffect, useState } from 'react'
import ThemedTooltip from '../components/ThemedTooltip'
import { api, type Workspace } from '../api/client'
import styles from './Workspaces.module.css'

const ACTIVE_WORKSPACE_KEY = 'prompt-engineer-active-workspace'

const WORKSPACE_FIELDS = [
  { key: 'name', label: 'Название', placeholder: 'Например: Аналитика fintech', help: 'Короткое имя для выбора на главной.' },
  { key: 'description', label: 'Описание', placeholder: 'Что хранит это пространство', help: 'Человеческое описание сценария и контекста.' },
  { key: 'glossary', label: 'Глоссарий', placeholder: 'Один термин на строку', help: 'Термины и определения проекта для учёта в промпте.' },
  { key: 'style_rules', label: 'Правила стиля', placeholder: 'Одно правило на строку', help: 'Тон, форматирование и редакционные правила.' },
  { key: 'default_constraints', label: 'Ограничения по умолчанию', placeholder: 'Одно ограничение на строку', help: 'Ограничения, которые автоматически попадают в промпт.' },
  { key: 'reference_snippets', label: 'Опорные фрагменты', placeholder: 'Один фрагмент на строку', help: 'Примеры и опорные куски контекста.' },
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
              <ThemedTooltip content={field.help} side="top" delayMs={280}>
                <span className={styles.helpIcon} aria-label={field.help}>
                  ?
                </span>
              </ThemedTooltip>
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
      <h1 className="pageTitleGradient">Пространства</h1>
      <p className={styles.caption}>
        Пространство (workspace) — контекст проекта: правила, глоссарий, ограничения и примеры. Выберите его при генерации промптов.
      </p>
      {error && <p className={styles.error}>{error}</p>}

      {items.length > 0 ? (
      <div className={styles.toolbar}>
        <button type="button" className={`${styles.toolbarPrimary} btn-primary`} onClick={() => setShowCreateModal(true)}>
          Создать пространство
        </button>
      </div>
      ) : null}

      {showCreateModal && (
        <div className={styles.modalOverlay} onClick={() => setShowCreateModal(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>Новое пространство</h3>
              <button className={styles.modalClose} onClick={() => setShowCreateModal(false)}>×</button>
            </div>
            <div className={styles.form}>
              {renderField(createForm, (key, value) => setCreateForm((prev) => ({ ...prev, [key]: value })))}
              <button type="button" className={`${styles.toolbarPrimary} btn-primary`} onClick={async () => {
                await createWorkspace()
                setShowCreateModal(false)
              }}>Создать</button>
            </div>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className={styles.emptyState}>
          <h2 className={styles.emptyTitle}>Пока нет пространств</h2>
          <p className={styles.emptyText}>
            Пространство сохраняет контекст проекта — термины, стиль, ограничения и короткие примеры. На главной вы
            подключаете его один раз, и каждый новый промпт учитывает эти правила без копипаста.
          </p>
          <div className={styles.exampleBlock}>
            <div className={styles.exampleLabel}>Пример заполнения</div>
            <p className={styles.exampleLead}>
              <strong>Название:</strong> Мобильное приложение доставки.<br />
              <strong>Глоссарий:</strong> «Заказ», «Курьер», «SLA» — как в продукте.<br />
              <strong>Правила стиля:</strong> короткие императивы, без воды, RU.<br />
              <strong>Ограничения:</strong> не раскрывать внутренние id; не обещать сроки без данных.<br />
              <strong>Фрагменты:</strong> 1–2 эталонных куска текста из вашей документации.
            </p>
          </div>
          <button type="button" className={`${styles.toolbarPrimary} btn-primary`} onClick={() => setShowCreateModal(true)}>
            Создать первое пространство
          </button>
        </div>
      ) : (
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
          const gCount = (cfg.glossary || []).length
          const cCount = (cfg.default_constraints || []).length
          const rCount = (cfg.reference_snippets || []).length
          const showMetrics = gCount > 0 || cCount > 0 || rCount > 0
          const isActive = activeId === workspace.id
          return (
            <div key={workspace.id || workspace.name} className={styles.card}>
              <div className={styles.cardHeader}>
                <div>
                  <h3>{workspace.name}</h3>
                  <p>{workspace.description}</p>
                </div>
                <div className={styles.cardHeaderActions}>
                  {isActive ? (
                    <ThemedTooltip
                      content="Это пространство подставляется в блок генерации на главной"
                      side="top"
                      delayMs={280}
                      block
                    >
                      <div className={styles.activePill}>
                        <span className={styles.activeDot} aria-hidden />
                        Активно сейчас
                      </div>
                    </ThemedTooltip>
                  ) : (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        localStorage.setItem(ACTIVE_WORKSPACE_KEY, String(workspace.id || 0))
                        setActiveId(Number(workspace.id || 0))
                      }}
                    >
                      Сделать активным
                    </button>
                  )}
                </div>
              </div>

              {showMetrics ? (
                <div className={styles.metrics}>
                  {gCount > 0 ? <span>Глоссарий: {gCount}</span> : null}
                  {cCount > 0 ? <span>Ограничения: {cCount}</span> : null}
                  {rCount > 0 ? <span>Фрагменты: {rCount}</span> : null}
                </div>
              ) : null}

              <p className={styles.editHint}>Заполните поля и нажмите «Сохранить», чтобы контекст учитывался в промптах.</p>
              <div className={styles.form}>
                {renderField(
                  form,
                  (key, value) => setEditing((prev) => ({ ...prev, [workspace.id || 0]: { ...form, [key]: value } })),
                )}
                <div className={styles.actions}>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={async () => {
                      await api.updateWorkspace(workspace.id || 0, {
                        name: form.name,
                        description: form.description,
                        glossary: splitLines(form.glossary),
                        style_rules: splitLines(form.style_rules),
                        default_constraints: splitLines(form.default_constraints),
                        reference_snippets: splitLines(form.reference_snippets),
                      })
                      load()
                    }}
                  >
                    Сохранить
                  </button>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={async () => {
                      await api.deleteWorkspace(workspace.id || 0)
                      if (activeId === workspace.id) {
                        localStorage.setItem(ACTIVE_WORKSPACE_KEY, '0')
                        setActiveId(0)
                      }
                      load()
                    }}
                  >
                    Удалить
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      )}
    </div>
  )
}
