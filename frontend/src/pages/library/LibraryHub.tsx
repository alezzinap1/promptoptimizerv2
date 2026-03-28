import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../api/client'
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

  const [counts, setCounts] = useState({ prompts: 0, techniques: 0, skills: 0 })

  const refreshPromptCount = useCallback(() => {
    api.getLibraryStats().then((s) => setCounts((c) => ({ ...c, prompts: s.total })))
  }, [])

  const refreshTechniqueCount = useCallback(() => {
    api.getTechniques().then((r) => setCounts((c) => ({ ...c, techniques: r.techniques.length })))
  }, [])

  const handleSkillsCount = useCallback((n: number) => {
    setCounts((c) => ({ ...c, skills: n }))
  }, [])

  useEffect(() => {
    refreshPromptCount()
    refreshTechniqueCount()
  }, [refreshPromptCount, refreshTechniqueCount])

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
            <span className={hubStyles.segLabel}>{t.label}</span>
            <span className={hubStyles.tabBadge} aria-hidden>
              {t.id === 'prompts' ? counts.prompts : t.id === 'techniques' ? counts.techniques : counts.skills}
            </span>
          </button>
        ))}
      </div>

      <div className={hubStyles.viewport}>
        <div
          className={hubStyles.track}
          style={{ transform: `translateX(calc(-${index} * 100% / 3))` }}
        >
          <div className={hubStyles.panel}>
            <PromptsPanel onPromptCountChanged={refreshPromptCount} />
          </div>
          <div className={hubStyles.panel}>
            <Techniques variant="embedded" onCatalogChanged={refreshTechniqueCount} />
          </div>
          <div className={hubStyles.panel}>
            <SkillsPanel onCountChange={handleSkillsCount} />
          </div>
        </div>
      </div>
    </div>
  )
}
