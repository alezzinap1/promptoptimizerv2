import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import PromptsPanel from './PromptsPanel'
import SkillsPanel from './SkillsPanel'
import Techniques from '../Techniques'
import hubStyles from './LibraryHub.module.css'

const TABS = [
  { id: 'prompts', label: 'Промпты' },
  { id: 'techniques', label: 'Техники' },
  { id: 'skills', label: 'Скиллы' },
] as const

type TabId = (typeof TABS)[number]['id']

function normalizeTab(raw: string | null): TabId {
  if (raw === 'techniques' || raw === 'skills' || raw === 'prompts') return raw
  return 'prompts'
}

export default function LibraryHub() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = useMemo(() => normalizeTab(searchParams.get('tab')), [searchParams])
  const idx = TABS.findIndex((t) => t.id === tab)
  const index = idx >= 0 ? idx : 0

  const setTab = (id: TabId) => {
    setSearchParams(id === 'prompts' ? {} : { tab: id })
  }

  return (
    <div className={hubStyles.hub}>
      <h1 className={`pageTitleGradient ${hubStyles.title}`}>Библиотека</h1>

      <div className={hubStyles.segmented} role="tablist" aria-label="Разделы библиотеки">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? hubStyles.segActive : hubStyles.seg}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={hubStyles.viewport}>
        <div
          className={hubStyles.track}
          style={{ transform: `translateX(calc(-${index} * 100% / 3))` }}
        >
          <div className={hubStyles.panel}>
            <PromptsPanel />
          </div>
          <div className={hubStyles.panel}>
            <Techniques variant="embedded" />
          </div>
          <div className={hubStyles.panel}>
            <SkillsPanel />
          </div>
        </div>
      </div>
    </div>
  )
}
