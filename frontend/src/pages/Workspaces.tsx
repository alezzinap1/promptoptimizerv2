import { useEffect, useState } from 'react'
import { api, type Workspace } from '../api/client'
import styles from './Workspaces.module.css'

const ACTIVE_WORKSPACE_KEY = 'prompt-engineer-active-workspace'

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
    preferred_target_model: 'unknown',
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
      preferred_target_model: 'unknown',
      glossary: '',
      style_rules: '',
      default_constraints: '',
      reference_snippets: '',
    })
    load()
  }

  return (
    <div className={styles.page}>
      <h1>Workspaces</h1>
      <p className={styles.caption}>Workspace хранит reusable контекст проекта: правила, глоссарий, ограничения и reference snippets.</p>
      {error && <p className={styles.error}>{error}</p>}

      <details className={styles.section} open={items.length === 0}>
        <summary>Новый workspace</summary>
        <div className={styles.form}>
          <input placeholder="Название" value={createForm.name} onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))} />
          <textarea rows={2} placeholder="Описание" value={createForm.description} onChange={(e) => setCreateForm((p) => ({ ...p, description: e.target.value }))} />
          <input placeholder="Preferred target model" value={createForm.preferred_target_model} onChange={(e) => setCreateForm((p) => ({ ...p, preferred_target_model: e.target.value }))} />
          <textarea rows={3} placeholder="Глоссарий" value={createForm.glossary} onChange={(e) => setCreateForm((p) => ({ ...p, glossary: e.target.value }))} />
          <textarea rows={3} placeholder="Style rules" value={createForm.style_rules} onChange={(e) => setCreateForm((p) => ({ ...p, style_rules: e.target.value }))} />
          <textarea rows={3} placeholder="Default constraints" value={createForm.default_constraints} onChange={(e) => setCreateForm((p) => ({ ...p, default_constraints: e.target.value }))} />
          <textarea rows={3} placeholder="Reference snippets" value={createForm.reference_snippets} onChange={(e) => setCreateForm((p) => ({ ...p, reference_snippets: e.target.value }))} />
          <button onClick={createWorkspace}>Создать workspace</button>
        </div>
      </details>

      <div className={styles.grid}>
        {items.map((workspace) => {
          const cfg = workspace.config || {}
          const form = editing[workspace.id || 0] || {
            name: workspace.name,
            description: workspace.description,
            preferred_target_model: cfg.preferred_target_model || 'unknown',
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
                  <input value={form.name} onChange={(e) => setEditing((prev) => ({ ...prev, [workspace.id || 0]: { ...form, name: e.target.value } }))} />
                  <textarea rows={2} value={form.description} onChange={(e) => setEditing((prev) => ({ ...prev, [workspace.id || 0]: { ...form, description: e.target.value } }))} />
                  <input value={form.preferred_target_model} onChange={(e) => setEditing((prev) => ({ ...prev, [workspace.id || 0]: { ...form, preferred_target_model: e.target.value } }))} />
                  <textarea rows={3} value={form.glossary} onChange={(e) => setEditing((prev) => ({ ...prev, [workspace.id || 0]: { ...form, glossary: e.target.value } }))} />
                  <textarea rows={3} value={form.style_rules} onChange={(e) => setEditing((prev) => ({ ...prev, [workspace.id || 0]: { ...form, style_rules: e.target.value } }))} />
                  <textarea rows={3} value={form.default_constraints} onChange={(e) => setEditing((prev) => ({ ...prev, [workspace.id || 0]: { ...form, default_constraints: e.target.value } }))} />
                  <textarea rows={3} value={form.reference_snippets} onChange={(e) => setEditing((prev) => ({ ...prev, [workspace.id || 0]: { ...form, reference_snippets: e.target.value } }))} />
                  <div className={styles.actions}>
                    <button onClick={async () => {
                      await api.updateWorkspace(workspace.id || 0, {
                        name: form.name,
                        description: form.description,
                        preferred_target_model: form.preferred_target_model,
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
