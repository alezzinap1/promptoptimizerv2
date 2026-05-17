import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../../api/client'
import ThemedTooltip from '../../components/ThemedTooltip'
import { useT } from '../../i18n'
import Presets from '../Presets'
import PromptsPanel from './PromptsPanel'
import SkillsPanel from './SkillsPanel'
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

type TabId = 'prompts' | 'presets' | 'skills'

function normalizeTab(raw: string | null): TabId {
  if (raw === 'presets' || raw === 'skills' || raw === 'prompts') return raw
  return 'prompts'
}

export default function LibraryHub() {
  const { t } = useT()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = useMemo(() => normalizeTab(searchParams.get('tab')), [searchParams])

  const tabLabels: Record<TabId, string> = {
    prompts: t.library.tabs.prompts,
    presets: t.library.tabs.presets,
    skills: t.library.tabs.skills,
  }

  const [counts, setCounts] = useState({ prompts: 0, presets: 0, skills: 0 })
  const [gridCols, setGridCols] = useState<GridCols>(() => loadGridCols())

  useEffect(() => {
    if (searchParams.get('tab') === 'techniques') {
      navigate('/techniques', { replace: true })
    }
  }, [searchParams, navigate])

  const refreshPromptCount = useCallback(() => {
    api.getLibraryStats().then((s) => setCounts((c) => ({ ...c, prompts: s.total })))
  }, [])

  const refreshPresetCount = useCallback(() => {
    api
      .listPresets()
      .then((r) => setCounts((c) => ({ ...c, presets: r.items.length })))
      .catch(() => setCounts((c) => ({ ...c, presets: 0 })))
  }, [])

  const handleSkillsCount = useCallback((n: number) => {
    setCounts((c) => ({ ...c, skills: n }))
  }, [])

  useEffect(() => {
    refreshPromptCount()
    refreshPresetCount()
  }, [refreshPromptCount, refreshPresetCount])

  useEffect(() => {
    const onRefresh = () => refreshPresetCount()
    window.addEventListener('metaprompt-presets-refresh', onRefresh)
    return () => window.removeEventListener('metaprompt-presets-refresh', onRefresh)
  }, [refreshPresetCount])

  const setTab = (id: TabId) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (id === 'prompts') next.delete('tab')
      else next.set('tab', id)
      return next
    })
  }

  const setGrid = (n: GridCols) => {
    setGridCols(n)
    localStorage.setItem(GRID_KEY, String(n))
  }

  return (
    <div className={hubStyles.hub}>
      <nav className={hubStyles.breadcrumbs} aria-label="Breadcrumb">
        <span className={hubStyles.breadcrumbRoot}>{t.library.hubTitle}</span>
        <span className={hubStyles.breadcrumbSep} aria-hidden>
          /
        </span>
        <span className={hubStyles.breadcrumbCurrent} aria-current="page">
          {tabLabels[tab]}
        </span>
      </nav>

      <div className={hubStyles.titleRow}>
        <h1 className={`pageTitleGradient ${hubStyles.title}`}>{t.library.hubTitle}</h1>
        <div className={hubStyles.gridToggle} role="group" aria-label="Плотность ленты промптов и скиллов">
          <ThemedTooltip content="Лента: три колонки (masonry)" side="bottom" delayMs={260}>
            <button
              type="button"
              className={gridCols === 3 ? hubStyles.gridToggleBtnActive : hubStyles.gridToggleBtn}
              aria-pressed={gridCols === 3}
              onClick={() => setGrid(3)}
            >
              <svg width="14" height="14" viewBox="0 0 12 12"><rect x="0" y="0" width="3" height="5" rx="0.5" fill="currentColor"/><rect x="4.5" y="0" width="3" height="5" rx="0.5" fill="currentColor"/><rect x="9" y="0" width="3" height="5" rx="0.5" fill="currentColor"/><rect x="0" y="7" width="3" height="5" rx="0.5" fill="currentColor"/><rect x="4.5" y="7" width="3" height="5" rx="0.5" fill="currentColor"/><rect x="9" y="7" width="3" height="5" rx="0.5" fill="currentColor"/></svg>
            </button>
          </ThemedTooltip>
          <ThemedTooltip content="Лента: четыре колонки (masonry)" side="bottom" delayMs={260}>
            <button
              type="button"
              className={gridCols === 4 ? hubStyles.gridToggleBtnActive : hubStyles.gridToggleBtn}
              aria-pressed={gridCols === 4}
              onClick={() => setGrid(4)}
            >
              <svg width="14" height="14" viewBox="0 0 12 12"><rect x="0" y="0" width="2.25" height="5" rx="0.5" fill="currentColor"/><rect x="3.25" y="0" width="2.25" height="5" rx="0.5" fill="currentColor"/><rect x="6.5" y="0" width="2.25" height="5" rx="0.5" fill="currentColor"/><rect x="9.75" y="0" width="2.25" height="5" rx="0.5" fill="currentColor"/><rect x="0" y="7" width="2.25" height="5" rx="0.5" fill="currentColor"/><rect x="3.25" y="7" width="2.25" height="5" rx="0.5" fill="currentColor"/><rect x="6.5" y="7" width="2.25" height="5" rx="0.5" fill="currentColor"/><rect x="9.75" y="7" width="2.25" height="5" rx="0.5" fill="currentColor"/></svg>
            </button>
          </ThemedTooltip>
        </div>
      </div>

      <div className={hubStyles.segmented} role="tablist" aria-label="Разделы библиотеки">
        {(['prompts', 'presets', 'skills'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? hubStyles.segActive : hubStyles.seg}
            onClick={() => setTab(id)}
          >
            <span className={hubStyles.segLabel}>{tabLabels[id]}</span>
            <span className={hubStyles.tabBadge} aria-hidden>
              {id === 'prompts' ? counts.prompts : id === 'presets' ? counts.presets : counts.skills}
            </span>
          </button>
        ))}
      </div>

      <div className={hubStyles.viewport}>
        <div className={hubStyles.panel} hidden={tab !== 'prompts'}>
          <PromptsPanel onPromptCountChanged={refreshPromptCount} gridCols={gridCols} />
        </div>
        <div className={hubStyles.panel} hidden={tab !== 'presets'}>
          <Presets variant="embedded" />
        </div>
        <div className={hubStyles.panel} hidden={tab !== 'skills'}>
          <SkillsPanel libraryActiveTab={tab} onCountChange={handleSkillsCount} gridCols={gridCols} />
        </div>
      </div>
    </div>
  )
}
