import { useCallback, useEffect, useRef, useState, type ClipboardEvent } from 'react'
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

export default function PublishToCommunityModal({ open, onClose, initial, onPublished }: Props) {
  const [title, setTitle] = useState(initial.title)
  const [prompt, setPrompt] = useState(initial.prompt)
  const [promptType, setPromptType] = useState<PublishPromptType>(initial.prompt_type)
  const [tags, setTags] = useState((initial.tags || []).join(', '))
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  const clearPreview = useCallback(() => {
    setPreviewUrl((u) => {
      if (u) URL.revokeObjectURL(u)
      return null
    })
  }, [])

  useEffect(() => {
    if (!open) return
    setTitle(initial.title)
    setPrompt(initial.prompt)
    setPromptType(initial.prompt_type)
    setTags((initial.tags || []).join(', '))
    setFile(null)
    clearPreview()
    setError(null)
  }, [open, initial, clearPreview])

  useEffect(() => {
    if (open) modalRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!file) {
      clearPreview()
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return url
    })
    return () => URL.revokeObjectURL(url)
  }, [file, clearPreview])

  const setImageFile = (f: File | null) => {
    setFile(f)
  }

  const onPasteImage = useCallback((e: ClipboardEvent) => {
    if (promptType !== 'image') return
    const items = e.clipboardData?.items
    if (!items) return
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        const f = it.getAsFile()
        if (f) {
          e.preventDefault()
          const name = f.name || 'paste.png'
          setImageFile(new File([f], name, { type: f.type || 'image/png' }))
          return
        }
      }
    }
  }, [promptType])

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
      const cat = promptType === 'image' ? 'image' : promptType === 'skill' ? 'skill' : initial.category || 'general'
      await api.createCommunityPrompt({
        title: t,
        prompt: p,
        description: '',
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
      <div
        ref={modalRef}
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        onPaste={onPasteImage}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pub-community-title"
        tabIndex={0}
      >
        <h3 id="pub-community-title" className={styles.title}>
          В сообщество
        </h3>
        <p className={styles.lead}>Видно всем. Без секретов и персональных данных.</p>

        <div className={styles.rowTight}>
          <label className={styles.fieldCompact}>
            Заголовок
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название" />
          </label>
          <label className={styles.fieldCompact}>
            Тип
            <select value={promptType} onChange={(e) => setPromptType(e.target.value as PublishPromptType)}>
              <option value="text">Текст</option>
              <option value="image">Картинка</option>
              <option value="skill">Скилл</option>
            </select>
          </label>
        </div>

        <label className={styles.fieldCompact}>
          Теги <span className={styles.optional}>(необязательно)</span>
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="через запятую" />
        </label>

        {promptType === 'image' && (
          <div className={styles.imageBlock}>
            <span className={styles.imageLabel}>Иллюстрация</span>
            <div className={styles.imageDrop}>
              {previewUrl && <img src={previewUrl} alt="" className={styles.imagePreview} />}
              <input
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp,image/gif,image/bmp,image/tiff,.jfif,.pjpeg"
                className={styles.fileInput}
                onChange={(e) => setImageFile(e.target.files?.[0] || null)}
              />
              <p className={styles.imageHint}>Файл или Ctrl+V со скриншотом. На сервере — 256×256, webp.</p>
            </div>
          </div>
        )}

        <label className={styles.fieldCompact}>
          Промпт
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={8} className={styles.promptArea} />
        </label>

        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.actions}>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={submitting}>
            Отмена
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={submitting}>
            {submitting ? '…' : 'Опубликовать'}
          </button>
        </div>
      </div>
    </div>
  )
}
