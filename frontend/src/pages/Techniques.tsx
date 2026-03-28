import { useEffect, useMemo, useState } from 'react'
import { api, type TechniqueRecord } from '../api/client'
import SelectDropdown from '../components/SelectDropdown'
import styles from './Techniques.module.css'

const TASK_TYPE_FILTER_OPTIONS = [
  { value: '', label: 'Все task types' },
  { value: 'code', label: 'code' },
  { value: 'analysis', label: 'analysis' },
  { value: 'research', label: 'research' },
  { value: 'structured_output', label: 'structured_output' },
  { value: 'debugging', label: 'debugging' },
  { value: 'general', label: 'general' },
]

const COMPLEXITY_FILTER_OPTIONS = [
  { value: '', label: 'Все уровни сложности' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
]

const EMPTY_FORM = {
  id: '',
  name: '',
  core_pattern: '',
  why_it_works: '',
  good_example: '',
  anti_patterns: '',
  task_types: '',
  complexity: '',
  combines_well_with: '',
}

export default function Techniques() {
  const [techniques, setTechniques] = useState<TechniqueRecord[]>([])
  const [search, setSearch] = useState('')
  const [taskType, setTaskType] = useState('')
  const [complexity, setComplexity] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showTechniqueModal, setShowTechniqueModal] = useState(false)
  const [detailTechnique, setDetailTechnique] = useState<TechniqueRecord | null>(null)

  const load = () => {
    setLoading(true)
    setError(null)
    api.getTechniques({ search: search || undefined, task_type: taskType || undefined, complexity: complexity || undefined })
      .then((r) => setTechniques(r.techniques))
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [search, taskType, complexity])

  const customCount = useMemo(
    () => techniques.filter((item) => item.origin === 'custom').length,
    [techniques],
  )
  const defaultCount = useMemo(
    () => techniques.filter((item) => item.origin !== 'custom').length,
    [techniques],
  )

  const submitForm = async () => {
    setSaving(true)
    setError(null)
    try {
      const payload: TechniqueRecord = {
        id: form.id.trim(),
        name: form.name.trim(),
        core_pattern: form.core_pattern.trim(),
        why_it_works: form.why_it_works.trim(),
        good_example: form.good_example.trim(),
        anti_patterns: form.anti_patterns.split('\n').map((item) => item.trim()).filter(Boolean),
        when_to_use: {
          task_types: form.task_types.split(',').map((item) => item.trim()).filter(Boolean),
          complexity: form.complexity.split(',').map((item) => item.trim()).filter(Boolean),
        },
        compatibility: {
          combines_well_with: form.combines_well_with.split(',').map((item) => item.trim()).filter(Boolean),
        },
        variants: [],
      }
      if (editingId) {
        await api.updateTechnique(editingId, payload)
      } else {
        await api.createTechnique(payload)
      }
      setForm(EMPTY_FORM)
      setEditingId(null)
      setShowTechniqueModal(false)
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить технику')
    } finally {
      setSaving(false)
    }
  }

  const openNewTechnique = () => {
    setDetailTechnique(null)
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowTechniqueModal(true)
  }

  const closeTechniqueModal = () => {
    setShowTechniqueModal(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  const startEdit = (e: React.MouseEvent, item: TechniqueRecord) => {
    e.stopPropagation()
    setDetailTechnique(null)
    setEditingId(item.db_id || null)
    setForm({
      id: item.id,
      name: item.name,
      core_pattern: item.core_pattern || '',
      why_it_works: item.why_it_works || '',
      good_example: item.good_example || '',
      anti_patterns: (item.anti_patterns || []).join('\n'),
      task_types: (item.when_to_use?.task_types || []).join(', '),
      complexity: (item.when_to_use?.complexity || []).join(', '),
      combines_well_with: (item.compatibility?.combines_well_with || []).join(', '),
    })
    setShowTechniqueModal(true)
  }

  const downloadPattern = (t: TechniqueRecord) => {
    const blob = new Blob([t.core_pattern || ''], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${t.id}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className={styles.techniques}>
      <h1 className="pageTitleGradient">База знаний техник промптинга</h1>
      <p className={styles.meta}>Дефолтные техники доступны каждому пользователю. Свои техники можно добавлять поверх базы.</p>
      <p className={styles.meta}>Сейчас доступно: {defaultCount} default / {customCount} custom.</p>

      <div className={styles.toolbar}>
        <button type="button" className={styles.createBtn} onClick={openNewTechnique}>
          Новая техника
        </button>
        <input
          type="search"
          placeholder="Поиск: chain of thought, роль..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={styles.search}
        />
        <SelectDropdown
          value={taskType}
          options={TASK_TYPE_FILTER_OPTIONS}
          onChange={setTaskType}
          aria-label="Фильтр по типу задачи"
          variant="toolbar"
          className={styles.toolbarFilter}
        />
        <SelectDropdown
          value={complexity}
          options={COMPLEXITY_FILTER_OPTIONS}
          onChange={setComplexity}
          aria-label="Фильтр по сложности"
          variant="toolbar"
          className={styles.toolbarFilter}
        />
      </div>

      {detailTechnique && (
        <div className={styles.modalOverlay} onClick={() => setDetailTechnique(null)}>
          <div className={styles.detailModalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>{detailTechnique.name || detailTechnique.id}</h3>
              <button type="button" className={styles.modalClose} onClick={() => setDetailTechnique(null)} aria-label="Закрыть">
                ×
              </button>
            </div>
            <p className={styles.meta}>
              <span className={styles.badges}>
                <span>{detailTechnique.origin === 'custom' ? 'custom' : 'default'}</span>
                {detailTechnique.editable ? <span>editable</span> : null}
              </span>
              {' · '}
              <code>{detailTechnique.id}</code>
            </p>
            {detailTechnique.when_to_use?.task_types?.length ? (
              <p className={styles.meta}><strong>Task types:</strong> {detailTechnique.when_to_use.task_types.join(', ')}</p>
            ) : null}
            {detailTechnique.when_to_use?.complexity?.length ? (
              <p className={styles.meta}><strong>Complexity:</strong> {detailTechnique.when_to_use.complexity.join(', ')}</p>
            ) : null}
            {detailTechnique.why_it_works ? (
              <section className={styles.detailSection}>
                <h4>Почему работает</h4>
                <p>{detailTechnique.why_it_works}</p>
              </section>
            ) : null}
            {detailTechnique.good_example ? (
              <section className={styles.detailSection}>
                <h4>Пример</h4>
                <p>{detailTechnique.good_example}</p>
              </section>
            ) : null}
            {detailTechnique.core_pattern ? (
              <section className={styles.detailSection}>
                <h4>Core pattern</h4>
                <pre className={styles.detailPre}>{detailTechnique.core_pattern}</pre>
                <button type="button" className={styles.detailDownloadBtn} onClick={() => downloadPattern(detailTechnique)}>
                  Скачать шаблон (.txt)
                </button>
              </section>
            ) : null}
            {detailTechnique.compatibility?.combines_well_with?.length ? (
              <section className={styles.detailSection}>
                <h4>Сочетается с</h4>
                <p>{detailTechnique.compatibility.combines_well_with.join(', ')}</p>
              </section>
            ) : null}
            {detailTechnique.anti_patterns?.length ? (
              <section className={styles.detailSection}>
                <h4>Anti-patterns</h4>
                <ul className={styles.detailList}>
                  {detailTechnique.anti_patterns.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </section>
            ) : null}
            {detailTechnique.variants?.length ? (
              <section className={styles.detailSection}>
                <h4>Варианты</h4>
                {detailTechnique.variants.map((variant, idx) => (
                  <div key={idx} className={styles.variant}>
                    <p><strong>{variant.name || `Вариант ${idx + 1}`}</strong></p>
                    {variant.use_when ? <p>{variant.use_when}</p> : null}
                    {variant.pattern ? <pre className={styles.detailPre}>{variant.pattern}</pre> : null}
                  </div>
                ))}
              </section>
            ) : null}
            {detailTechnique.editable && detailTechnique.db_id ? (
              <div className={styles.detailFooter}>
                <button type="button" onClick={(e) => startEdit(e, detailTechnique)}>Изменить</button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {showTechniqueModal && (
        <div className={styles.modalOverlay} onClick={closeTechniqueModal}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>{editingId ? 'Редактирование техники' : 'Новая пользовательская техника'}</h3>
              <button type="button" className={styles.modalClose} onClick={closeTechniqueModal} aria-label="Закрыть">
                ×
              </button>
            </div>
            <p className={styles.meta}>Кастомных техник: {customCount}</p>
            <div className={styles.modalForm}>
              <div className={styles.createGrid}>
                <input value={form.id} onChange={(e) => setForm((prev) => ({ ...prev, id: e.target.value }))} placeholder="ID: my_custom_technique" disabled={!!editingId} />
                <input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Название" />
                <input value={form.task_types} onChange={(e) => setForm((prev) => ({ ...prev, task_types: e.target.value }))} placeholder="Task types через запятую" />
                <input value={form.complexity} onChange={(e) => setForm((prev) => ({ ...prev, complexity: e.target.value }))} placeholder="Complexity: low, medium, high" />
                <textarea rows={4} value={form.core_pattern} onChange={(e) => setForm((prev) => ({ ...prev, core_pattern: e.target.value }))} placeholder="Core pattern" />
                <textarea rows={4} value={form.why_it_works} onChange={(e) => setForm((prev) => ({ ...prev, why_it_works: e.target.value }))} placeholder="Почему техника работает" />
                <textarea rows={3} value={form.good_example} onChange={(e) => setForm((prev) => ({ ...prev, good_example: e.target.value }))} placeholder="Хороший пример" />
                <textarea rows={3} value={form.combines_well_with} onChange={(e) => setForm((prev) => ({ ...prev, combines_well_with: e.target.value }))} placeholder="Совместимые техники через запятую" />
                <textarea rows={4} value={form.anti_patterns} onChange={(e) => setForm((prev) => ({ ...prev, anti_patterns: e.target.value }))} placeholder="Anti-patterns, по одному на строку" />
              </div>
              <div className={styles.formActions}>
                <button type="button" className={styles.primaryBtn} onClick={() => void submitForm()} disabled={saving || !form.id.trim() || !form.name.trim()}>
                  {saving ? 'Сохраняю...' : editingId ? 'Сохранить изменения' : 'Добавить технику'}
                </button>
                <button type="button" onClick={closeTechniqueModal}>
                  Отмена
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && <p className={styles.error}>{error}</p>}

      {loading ? (
        <p>Загрузка...</p>
      ) : techniques.length === 0 ? (
        <p className={styles.empty}>Техники не найдены</p>
      ) : (
        <div className={styles.grid}>
          {techniques.map((t) => (
            <div
              key={t.id}
              className={styles.card}
              role="button"
              tabIndex={0}
              onClick={() => setDetailTechnique(t)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setDetailTechnique(t)
                }
              }}
            >
              <div className={styles.cardHead}>
                <div>
                  <h3>{t.name || t.id}</h3>
                  <p className={styles.badges}>
                    <span>{t.origin === 'custom' ? 'custom' : 'default'}</span>
                    {t.editable && <span>editable</span>}
                  </p>
                </div>
                {t.editable && t.db_id ? (
                  <div className={styles.cardActions} onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={(e) => startEdit(e, t)}>Изменить</button>
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation()
                        await api.deleteTechnique(t.db_id as number)
                        if (editingId === t.db_id) {
                          closeTechniqueModal()
                        }
                        setDetailTechnique((cur) => (cur?.id === t.id ? null : cur))
                        load()
                      }}
                    >
                      Удалить
                    </button>
                  </div>
                ) : null}
              </div>
              {t.when_to_use?.task_types && (
                <p className={styles.meta}>{t.when_to_use.task_types.join(', ')}</p>
              )}
              {t.core_pattern && (
                <pre className={styles.pattern}>{t.core_pattern.slice(0, 150)}...</pre>
              )}
              <p className={styles.cardHint}>Нажмите карточку для полного описания</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
