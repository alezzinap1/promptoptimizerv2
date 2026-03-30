import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../../api/client'
import PromptsPanel from './PromptsPanel'
import SkillsPanel from './SkillsPanel'
import Techniques from '../Techniques'
import hubStyles from './LibraryHub.module.css'

const GRID_KEY = 'prompt-engineer-library-grid-cols'
type GridCols = 3 | 4

function loadGridCols(): GridCols {
  try {
    const v = localStorage.getItem(GRID_KEY)
    if (v === '4') return 4
  } catch {
    /* ignore */
  }
  return 3
}

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
  const [gridCols, setGridCols] = useState<GridCols>(() => loadGridCols())

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

  const setGrid = (n: GridCols) => {
    setGridCols(n)
    localStorage.setItem(GRID_KEY, String(n))
  }

  return (
    <div className={hubStyles.hub}>
      <div className={hubStyles.titleRow}>
        <h1 className={`pageTitleGradient ${hubStyles.title}`}>Библиотека</h1>
        <div className={hubStyles.gridToggle} role="group" aria-label="Количество колонок сетки">
          <button
            type="button"
            className={gridCols === 3 ? hubStyles.gridToggleBtnActive : hubStyles.gridToggleBtn}
            aria-pressed={gridCols === 3}
            onClick={() => setGrid(3)}
            title="Три колонки"
          >
            <svg width="14" height="14" viewBox="0 0 12 12"><rect x="0" y="0" width="3" height="5" rx="0.5" fill="currentColor"/><rect x="4.5" y="0" width="3" height="5" rx="0.5" fill="currentColor"/><rect x="9" y="0" width="3" height="5" rx="0.5" fill="currentColor"/><rect x="0" y="7" width="3" height="5" rx="0.5" fill="currentColor"/><rect x="4.5" y="7" width="3" height="5" rx="0.5" fill="currentColor"/><rect x="9" y="7" width="3" height="5" rx="0.5" fill="currentColor"/></svg>
          </button>
          <button
            type="button"
            className={gridCols === 4 ? hubStyles.gridToggleBtnActive : hubStyles.gridToggleBtn}
            aria-pressed={gridCols === 4}
            onClick={() => setGrid(4)}
            title="Четыре колонки"
          >
            <svg width="14" height="14" viewBox="0 0 12 12"><rect x="0" y="0" width="2.25" height="5" rx="0.5" fill="currentColor"/><rect x="3.25" y="0" width="2.25" height="5" rx="0.5" fill="currentColor"/><rect x="6.5" y="0" width="2.25" height="5" rx="0.5" fill="currentColor"/><rect x="9.75" y="0" width="2.25" height="5" rx="0.5" fill="currentColor"/><rect x="0" y="7" width="2.25" height="5" rx="0.5" fill="currentColor"/><rect x="3.25" y="7" width="2.25" height="5" rx="0.5" fill="currentColor"/><rect x="6.5" y="7" width="2.25" height="5" rx="0.5" fill="currentColor"/><rect x="9.75" y="7" width="2.25" height="5" rx="0.5" fill="currentColor"/></svg>
          </button>
        </div>
      </div>

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
            <PromptsPanel onPromptCountChanged={refreshPromptCount} gridCols={gridCols} />
          </div>
          <div className={hubStyles.panel}>
            <Techniques variant="embedded" onCatalogChanged={refreshTechniqueCount} gridCols={gridCols} />
          </div>
          <div className={hubStyles.panel}>
            <SkillsPanel onCountChange={handleSkillsCount} gridCols={gridCols} />
          </div>
        </div>
      </div>
    </div>
  )
}
