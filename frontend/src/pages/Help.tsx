import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import readmeRaw from '../docs/user/README.md?raw'
import onboardingRaw from '../docs/user/ONBOARDING.md?raw'
import homeWorkflowRaw from '../docs/user/HOME_WORKFLOW.md?raw'
import sectionsRaw from '../docs/user/SECTIONS.md?raw'
import simpleRaw from '../docs/user/SIMPLE_MODE.md?raw'
import glossaryRaw from '../docs/user/GLOSSARY.md?raw'
import expertLevelsFaqRaw from '../docs/user/EXPERT_LEVELS_FAQ.md?raw'
import styles from './Help.module.css'

const SECTIONS = [
  { id: 'overview', title: 'Обзор', content: readmeRaw as string },
  { id: 'onboarding', title: 'Онбординг', content: onboardingRaw as string },
  { id: 'home', title: 'Главная и поток', content: homeWorkflowRaw as string },
  { id: 'expert-levels', title: 'Уровни студии', content: expertLevelsFaqRaw as string },
  { id: 'sections', title: 'Разделы приложения', content: sectionsRaw as string },
  { id: 'simple', title: 'Простой режим', content: simpleRaw as string },
  { id: 'glossary', title: 'Глоссарий', content: glossaryRaw as string },
] as const

export default function Help() {
  const [active, setActive] = useState<(typeof SECTIONS)[number]['id']>('overview')
  const current = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0]

  return (
    <div className={styles.layout}>
      <aside className={styles.toc}>
        <h1 className={styles.tocTitle}>Справка</h1>
        <nav className={styles.tocNav}>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={s.id === active ? styles.tocItemActive : styles.tocItem}
              onClick={() => setActive(s.id)}
            >
              {s.title}
            </button>
          ))}
        </nav>
      </aside>
      <article className={styles.body}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
          {current.content}
        </ReactMarkdown>
      </article>
    </div>
  )
}
