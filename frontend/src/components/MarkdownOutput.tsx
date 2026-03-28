import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import styles from './MarkdownOutput.module.css'

type Props = {
  children: string
  className?: string
}

/** Рендер Markdown для вывода модели (не для полей ввода). Санитизация через rehype-sanitize. */
export default function MarkdownOutput({ children, className }: Props) {
  const text = children ?? ''
  if (!text.trim()) return null
  return (
    <div className={`${styles.prose} ${className || ''}`.trim()}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
