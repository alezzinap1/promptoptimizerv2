import { useEffect, useMemo, useState } from 'react'
import { api, type TechniqueRecord } from '../api/client'
import MarkdownOutput from '../components/MarkdownOutput'
import SelectDropdown from '../components/SelectDropdown'
import styles from './Techniques.module.css'

const TASK_TYPE_FILTER_OPTIONS = [
  { value: '', label: 'Все типы задач' },
  { value: 'code', label: 'Код (code)' },
  { value: 'analysis', label: 'Анализ (analysis)' },
  { value: 'research', label: 'Исследование (research)' },
  { value: 'structured_output', label: 'Структурированный вывод (structured_output)' },
  { value: 'debugging', label: 'Отладка (debugging)' },
  { value: 'general', label: 'Общее (general)' },
]

const COMPLEXITY_FILTER_OPTIONS = [
  { value: '', label: 'Все уровни сложности' },
  { value: 'low', label: 'Низкая (low)' },
  { value: 'medium', label: 'Средняя (medium)' },
  { value: 'high', label: 'Высокая (high)' },
]

function techniqueLeadText(t: TechniqueRecord): string {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
  const why = norm(t.why_it_works || '')
  if (why) {
    if (why.length <= 260) return why
    const cut = why.slice(0, 257)
    const last = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'))
    if (last > 100) return why.slice(0, last + 1).trim()
    return `${cut.trim()}…`
  }
  const core = norm(t.core_pattern || '')
  if (core) return core.length > 260 ? `${core.slice(0, 257)}…` : core
  return 'Откройте карточку, чтобы увидеть подробное описание и примеры использования.'
}

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

export default function Techniques({
  variant = 'page',
  onCatalogChanged,
}: {
  variant?: 'page' | 'embedded'
  onCatalogChanged?: () => void
}) {
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

  const load = (): Promise<void> => {
    setLoading(true)
    setError(null)
    return api
      .getTechniques({
        search: search || undefined,
        task_type: taskType || undefined,
        complexity: complexity || undefined,
      })
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
      await load()
      onCatalogChanged?.()
      window.dispatchEvent(new CustomEvent('metaprompt-nav-refresh'))
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
      {variant === 'page' ? (
        <>
          <h1 className="pageTitleGradient">База знаний техник промптинга</h1>
          <p className={styles.meta}>
            Дефолтные техники доступны каждому пользователю. Свои техники можно добавлять поверх базы.
          </p>
        </>
      ) : (
        <h2 className="pageTitleGradient">Техники</h2>
      )}
      <p className={styles.meta}>
        <span>{defaultCount} встроенных техник</span>
        {customCount > 0 ? <span> · своих: {customCount}</span> : null}
        {' · '}
        <button type="button" className={styles.inlineLinkBtn} onClick={openNewTechnique}>
          Добавить свою
        </button>
      </p>

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
                <MarkdownOutput className={styles.detailMd}>{detailTechnique.why_it_works}</MarkdownOutput>
              </section>
            ) : null}
            {detailTechnique.good_example ? (
              <section className={styles.detailSection}>
                <h4>Пример</h4>
                <MarkdownOutput className={styles.detailMd}>{detailTechnique.good_example}</MarkdownOutput>
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
                    {variant.use_when ? (
                      <MarkdownOutput className={styles.detailMd}>{variant.use_when}</MarkdownOutput>
                    ) : null}
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
                <input value={form.id} onChange={(e) => setForm((prev) => ({ ...prev, id: e.target.value }))} placeholder="Идентификатор, напр. my_custom_technique" disabled={!!editingId} />
                <input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Название" />
                <input value={form.task_types} onChange={(e) => setForm((prev) => ({ ...prev, task_types: e.target.value }))} placeholder="Типы задач через запятую (code, general, …)" />
                <input value={form.complexity} onChange={(e) => setForm((prev) => ({ ...prev, complexity: e.target.value }))} placeholder="Сложность: low, medium, high" />
                <textarea rows={4} value={form.core_pattern} onChange={(e) => setForm((prev) => ({ ...prev, core_pattern: e.target.value }))} placeholder="Базовый паттерн (core pattern)" />
                <textarea rows={4} value={form.why_it_works} onChange={(e) => setForm((prev) => ({ ...prev, why_it_works: e.target.value }))} placeholder="Почему техника работает" />
                <textarea rows={3} value={form.good_example} onChange={(e) => setForm((prev) => ({ ...prev, good_example: e.target.value }))} placeholder="Хороший пример" />
                <textarea rows={3} value={form.combines_well_with} onChange={(e) => setForm((prev) => ({ ...prev, combines_well_with: e.target.value }))} placeholder="Совместимые техники через запятую" />
                <textarea rows={4} value={form.anti_patterns} onChange={(e) => setForm((prev) => ({ ...prev, anti_patterns: e.target.value }))} placeholder="Анти-паттерны, по одному на строку" />
              </div>
              <div className={styles.formActions}>
                <button type="button" className={styles.primaryBtn} onClick={() => void submitForm()} disabled={saving || !form.id.trim() || !form.name.trim()}>
                  {saving ? 'Сохраняю...' : editingId ? 'Сохранить изменения' : 'Добавить технику'}
                </button>
                <button type="button" className="btn-ghost" onClick={closeTechniqueModal}>
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
                  {(t.origin === 'custom' || t.editable) && (
                    <div className={styles.badges}>
                      <span className={styles.chipMine}>Моя</span>
                      {t.editable && <span className={styles.chipMuted}>Редактируемая</span>}
                    </div>
                  )}
                </div>
                {t.editable && t.db_id ? (
                  <div className={styles.cardActions} onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={(e) => startEdit(e, t)}>Изменить</button>
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={async (e) => {
                        e.stopPropagation()
                        await api.deleteTechnique(t.db_id as number)
                        if (editingId === t.db_id) {
                          closeTechniqueModal()
                        }
                        setDetailTechnique((cur) => (cur?.id === t.id ? null : cur))
                        await load()
                        onCatalogChanged?.()
                        window.dispatchEvent(new CustomEvent('metaprompt-nav-refresh'))
                      }}
                    >
                      Удалить
                    </button>
                  </div>
                ) : null}
              </div>
              <div className={styles.cardDescMd}>
                {t.why_it_works ? (
                  <MarkdownOutput className={styles.cardDescProse}>{t.why_it_works}</MarkdownOutput>
                ) : (
                  <p className={styles.cardDesc}>{techniqueLeadText(t)}</p>
                )}
              </div>
              {t.when_to_use?.task_types && t.when_to_use.task_types.length > 0 && (
                <p className={styles.tagMeta} title={t.when_to_use.task_types.join(', ')}>
                  Типы задач: {t.when_to_use.task_types.join(', ')}
                </p>
              )}
              <div className={styles.cardFooter}>
                <span className={styles.moreLink}>Подробнее →</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
