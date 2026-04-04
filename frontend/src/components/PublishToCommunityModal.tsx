import { useEffect, useState } from 'react'
import { api } from '../api/client'
import styles from './PublishToCommunityModal.module.css'

export type PublishPromptType = 'text' | 'image' | 'skill'

export type PublishToCommunityInitial = {
  title: string
  prompt: string
  description?: string
  prompt_type: PublishPromptType
  category?: string
  tags?: string[]
}

type Props = {
  open: boolean
  onClose: () => void
  initial: PublishToCommunityInitial
  onPublished?: () => void
}

const CATEGORIES = [
  { value: 'general', label: 'Общее' },
  { value: 'writing', label: 'Тексты' },
  { value: 'code', label: 'Код' },
  { value: 'image', label: 'Изображения' },
  { value: 'skill', label: 'Скиллы' },
]

export default function PublishToCommunityModal({ open, onClose, initial, onPublished }: Props) {
  const [title, setTitle] = useState(initial.title)
  const [description, setDescription] = useState(initial.description || '')
  const [prompt, setPrompt] = useState(initial.prompt)
  const [promptType, setPromptType] = useState<PublishPromptType>(initial.prompt_type)
  const [category, setCategory] = useState(initial.category || 'general')
  const [tags, setTags] = useState((initial.tags || []).join(', '))
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTitle(initial.title)
    setDescription(initial.description || '')
    setPrompt(initial.prompt)
    setPromptType(initial.prompt_type)
    setCategory(initial.category || 'general')
    setTags((initial.tags || []).join(', '))
    setFile(null)
    setError(null)
  }, [open, initial])

  if (!open) return null

  const submit = async () => {
    const t = title.trim()
    const p = prompt.trim()
    if (!t || !p) {
      setError('Укажите заголовок и текст')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      let imagePath: string | null = null
      if (promptType === 'image' && file) {
        const up = await api.uploadCommunityImage(file)
        imagePath = up.path
      }
      const cat =
        promptType === 'image' ? 'image' : promptType === 'skill' ? 'skill' : category
      await api.createCommunityPrompt({
        title: t,
        prompt: p,
        description: description.trim(),
        prompt_type: promptType,
        category: cat,
        tags: tags
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
        image_path: imagePath,
      })
      onPublished?.()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось опубликовать')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose} role="presentation">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="pub-community-title">
        <h3 id="pub-community-title" className={styles.title}>
          Публикация в сообщество
        </h3>
        <p className={styles.lead}>
          Материал станет виден другим пользователям. Не публикуйте секреты и персональные данные.
        </p>
        <label className={styles.field}>
          Заголовок
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Краткое название" />
        </label>
        <label className={styles.field}>
          Описание (необязательно)
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Для чего этот промпт" />
        </label>
        <div className={styles.row}>
          <label className={styles.field}>
            Тип
            <select value={promptType} onChange={(e) => setPromptType(e.target.value as PublishPromptType)}>
              <option value="text">Текст / чат</option>
              <option value="image">Изображение</option>
              <option value="skill">Скилл</option>
            </select>
          </label>
          {promptType === 'text' && (
            <label className={styles.field}>
              Категория
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <label className={styles.field}>
          Теги через запятую
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="seo, blog, midjourney…" />
        </label>
        {promptType === 'image' && (
          <label className={styles.field}>
            Превью результата (jpg/png/webp/gif, до 5 МБ) — по желанию
            <input type="file" accept=".jpg,.jpeg,.png,.webp,.gif" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
        )}
        <label className={styles.field}>
          Текст промпта / скилла
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={10} className={styles.promptArea} />
        </label>
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={submitting}>
            Отмена
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={submitting}>
            {submitting ? 'Публикация…' : 'Опубликовать'}
          </button>
        </div>
      </div>
    </div>
  )
}
