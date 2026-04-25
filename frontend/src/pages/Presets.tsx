import { useCallback, useEffect, useState } from 'react'
import { api, type UserPresetRecord } from '../api/client'
import styles from './Workspaces.module.css'

function dispatchPresetsRefresh(): void {
  window.dispatchEvent(new CustomEvent('metaprompt-presets-refresh'))
}

export type PresetsVariant = 'page' | 'embedded'

export default function Presets({ variant = 'page' }: { variant?: PresetsVariant }) {
  const embedded = variant === 'embedded'
  const [items, setItems] = useState<UserPresetRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [createKind, setCreateKind] = useState<'image' | 'skill'>('image')
  const [createName, setCreateName] = useState('')
  const [createDesc, setCreateDesc] = useState('')
  const [createBody, setCreateBody] = useState('')

  const load = useCallback(() => {
    api
      .listPresets()
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка загрузки'))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const imageItems = items.filter((x) => x.kind === 'image')
  const skillItems = items.filter((x) => x.kind === 'skill')

  const openCreate = (kind: 'image' | 'skill') => {
    setCreateKind(kind)
    setCreateName('')
    setCreateDesc('')
    setCreateBody('')
    setShowCreate(true)
  }

  const submitCreate = async () => {
    const payload =
      createKind === 'image'
        ? { raw_text: createBody.trim() }
        : { hint: createBody.trim() }
    await api.createPreset({
      kind: createKind,
      name: createName.trim(),
      description: createDesc.trim(),
      payload,
    })
    setShowCreate(false)
    load()
    dispatchPresetsRefresh()
  }

  const deletePreset = async (id: number) => {
    await api.deletePreset(id)
    load()
    dispatchPresetsRefresh()
  }

  return (
    <div className={embedded ? styles.presetsEmbeddedWrap : styles.page}>
      {!embedded ? (
        <>
          <h1 className="pageTitleGradient">Пресеты</h1>
          <p className={styles.caption}>
            Собственные пресеты для студии на главной: стиль для фото-промптов и дополнительные правила для генерации скиллов.
            Выбор — в панели ввода рядом с workspace, когда активны режимы «Фото» или «Скилл».
          </p>
        </>
      ) : (
        <p className={styles.caption} style={{ marginTop: 0 }}>
          Пресеты для режимов «Фото» и «Скилл» на главной; выбор — в композере студии.
        </p>
      )}
      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.section}>
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Фото</h2>
        <p className={styles.caption} style={{ marginTop: 8 }}>
          Текст стиля (свет, палитра, техника) подмешивается в запрос генерации изображения.
        </p>
        <div className={styles.toolbar}>
          <button type="button" className={`${styles.toolbarPrimary} btn-primary`} onClick={() => openCreate('image')}>
            Новый пресет
          </button>
        </div>
        {imageItems.length === 0 ? (
          <p className={styles.caption}>Пока нет пользовательских пресетов для фото.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {imageItems.map((p) => (
              <li key={p.id} style={{ marginBottom: 12 }}>
                <strong>{p.name}</strong>
                {p.description ? ` — ${p.description}` : ''}
                <button
                  type="button"
                  className="btn-danger"
                  style={{ marginLeft: 12, fontSize: 12, padding: '4px 10px' }}
                  onClick={() => void deletePreset(p.id)}
                >
                  Удалить
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.section}>
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Скилл</h2>
        <p className={styles.caption} style={{ marginTop: 8 }}>
          Дополнительные правила структуры и тона для генерации скилла (YAML/Markdown-блок в [PROMPT]).
        </p>
        <div className={styles.toolbar}>
          <button type="button" className={`${styles.toolbarPrimary} btn-primary`} onClick={() => openCreate('skill')}>
            Новый пресет
          </button>
        </div>
        {skillItems.length === 0 ? (
          <p className={styles.caption}>Пока нет пресетов для скиллов.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {skillItems.map((p) => (
              <li key={p.id} style={{ marginBottom: 12 }}>
                <strong>{p.name}</strong>
                {p.description ? ` — ${p.description}` : ''}
                <button
                  type="button"
                  className="btn-danger"
                  style={{ marginLeft: 12, fontSize: 12, padding: '4px 10px' }}
                  onClick={() => void deletePreset(p.id)}
                >
                  Удалить
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showCreate && (
        <div className={styles.modalOverlay} onClick={() => setShowCreate(false)}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>{createKind === 'image' ? 'Новый пресет для фото' : 'Новый пресет для скилла'}</h3>
              <button type="button" className={styles.modalClose} onClick={() => setShowCreate(false)}>
                ×
              </button>
            </div>
            <div className={styles.form}>
              <label className={styles.formField}>
                <span className={styles.labelRow}>
                  <span>Название</span>
                </span>
                <input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Короткое имя" />
              </label>
              <label className={styles.formField}>
                <span className={styles.labelRow}>
                  <span>Описание</span>
                </span>
                <textarea rows={2} value={createDesc} onChange={(e) => setCreateDesc(e.target.value)} placeholder="Необязательно" />
              </label>
              <label className={styles.formField}>
                <span className={styles.labelRow}>
                  <span>{createKind === 'image' ? 'Текст стиля' : 'Подсказка для генерации'}</span>
                </span>
                <textarea
                  rows={8}
                  value={createBody}
                  onChange={(e) => setCreateBody(e.target.value)}
                  placeholder={
                    createKind === 'image'
                      ? 'Опишите визуальный стиль: свет, палитру, камеру, негатив…'
                      : 'Например: всегда YAML frontmatter; раздел «Anti-patterns»; язык ответа — русский.'
                  }
                />
              </label>
              <button
                type="button"
                className={`${styles.toolbarPrimary} btn-primary`}
                onClick={() => void submitCreate()}
                disabled={!createName.trim() || !createBody.trim()}
              >
                Создать
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
