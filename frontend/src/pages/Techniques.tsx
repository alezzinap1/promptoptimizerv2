import { useEffect, useMemo, useState } from 'react'
import { api, type TechniqueRecord } from '../api/client'
import styles from './Techniques.module.css'

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
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowTechniqueModal(true)
  }

  const closeTechniqueModal = () => {
    setShowTechniqueModal(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  const startEdit = (item: TechniqueRecord) => {
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

  return (
    <div className={styles.techniques}>
      <h1>База знаний техник промптинга</h1>
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
        <select className={styles.search} value={taskType} onChange={(e) => setTaskType(e.target.value)}>
          <option value="">Все task types</option>
          <option value="code">code</option>
          <option value="analysis">analysis</option>
          <option value="research">research</option>
          <option value="structured_output">structured_output</option>
          <option value="debugging">debugging</option>
          <option value="general">general</option>
        </select>
        <select className={styles.search} value={complexity} onChange={(e) => setComplexity(e.target.value)}>
          <option value="">Все уровни сложности</option>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </select>
      </div>

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
            <div key={t.id} className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <h3>{t.name || t.id}</h3>
                  <p className={styles.badges}>
                    <span>{t.origin === 'custom' ? 'custom' : 'default'}</span>
                    {t.editable && <span>editable</span>}
                  </p>
                </div>
                {t.editable && t.db_id ? (
                  <div className={styles.cardActions}>
                    <button onClick={() => startEdit(t)}>Изменить</button>
                    <button onClick={async () => {
                      await api.deleteTechnique(t.db_id as number)
                      if (editingId === t.db_id) {
                        closeTechniqueModal()
                      }
                      load()
                    }}>
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
              <details className={styles.details}>
                <summary>Подробнее</summary>
                {t.why_it_works && <p><strong>Почему работает:</strong> {t.why_it_works}</p>}
                {t.good_example && <p><strong>Пример:</strong> {t.good_example}</p>}
                {t.compatibility?.combines_well_with?.length ? (
                  <p><strong>Хорошо сочетается с:</strong> {t.compatibility.combines_well_with.join(', ')}</p>
                ) : null}
                {t.anti_patterns?.length ? (
                  <div>
                    <strong>Anti-patterns</strong>
                    <ul>
                      {t.anti_patterns.map((item, idx) => <li key={idx}>{item}</li>)}
                    </ul>
                  </div>
                ) : null}
                {t.variants?.length ? (
                  <div>
                    <strong>Варианты</strong>
                    {t.variants.map((variant, idx) => (
                      <div key={idx} className={styles.variant}>
                        <p><strong>{variant.name || `Вариант ${idx + 1}`}</strong></p>
                        {variant.use_when && <p>{variant.use_when}</p>}
                        {variant.pattern && <pre className={styles.pattern}>{variant.pattern}</pre>}
                      </div>
                    ))}
                  </div>
                ) : null}
                {t.core_pattern && (
                  <button onClick={() => {
                    const blob = new Blob([t.core_pattern || ''], { type: 'text/plain;charset=utf-8' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `${t.id}.txt`
                    a.click()
                    URL.revokeObjectURL(url)
                  }}>
                    Скачать шаблон
                  </button>
                )}
              </details>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
