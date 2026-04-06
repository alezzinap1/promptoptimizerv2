import { useMemo, useState, type RefObject } from 'react'
import type { ImageStyleDef } from '../lib/imageStyles'
import PortalDropdown from './PortalDropdown'
import styles from './ImageStylePickerPopover.module.css'

type FilterMode = 'all' | 'favorites'

type Props = {
  open: boolean
  onClose: () => void
  anchorRef: RefObject<HTMLElement | null>
  items: ImageStyleDef[]
  selectedIds: string[]
  onToggle: (id: string) => void
  favoriteIds: Set<string>
  onToggleFavorite: (id: string) => void
}

export default function ImageStylePickerPopover({
  open,
  onClose,
  anchorRef,
  items,
  selectedIds,
  onToggle,
  favoriteIds,
  onToggleFavorite,
}: Props) {
  const sel = new Set(selectedIds)
  const [filter, setFilter] = useState<FilterMode>('all')

  const shownItems = useMemo(() => {
    if (filter === 'favorites') {
      return items.filter((s) => favoriteIds.has(s.id))
    }
    return items
  }, [items, filter, favoriteIds])

  return (
    <PortalDropdown open={open} onClose={onClose} anchorRef={anchorRef} minWidth={340} align="left" panelClassName={styles.stylePickerPanel}>
      <div className={styles.head}>
        <h3 className={styles.title}>Стили</h3>
        <div className={styles.filterRow} role="tablist" aria-label="Фильтр списка стилей">
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'all'}
            className={`${styles.filterTab} ${filter === 'all' ? styles.filterTabActive : ''}`}
            onClick={() => setFilter('all')}
          >
            Все
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === 'favorites'}
            className={`${styles.filterTab} ${filter === 'favorites' ? styles.filterTabActive : ''}`}
            onClick={() => setFilter('favorites')}
          >
            Избранные
          </button>
        </div>
        <p className={styles.sub}>Карточка — выбрать стиль. Звезда — только избранное (не выбирает стиль).</p>
      </div>
      <div className={styles.scroll}>
        {filter === 'favorites' && shownItems.length === 0 ? (
          <p className={styles.emptyFavorites}>Пока нет избранных. Откройте «Все» и отметьте ☆ у нужных стилей.</p>
        ) : (
          <div className={styles.grid}>
            {shownItems.map((s) => {
              const isFav = favoriteIds.has(s.id)
              const isOn = sel.has(s.id)
              return (
                <div key={s.id} className={`${styles.tileWrap} ${isOn ? styles.tileWrapOn : ''}`}>
                  <button
                    type="button"
                    className={styles.tileMain}
                    onClick={() => onToggle(s.id)}
                    title={`${s.label}: ${s.description}`}
                  >
                    <div className={styles.tilePreview}>
                      {s.thumbSrc ? (
                        <img className={styles.tileBg} src={s.thumbSrc} alt="" loading="lazy" />
                      ) : (
                        <div className={styles.tileBg} style={{ background: s.preview }} />
                      )}
                      <div className={styles.tileScrim} aria-hidden />
                      <span className={styles.tileName}>{s.label}</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`${styles.starBtn} ${isFav ? styles.starBtnOn : ''}`}
                    title={isFav ? 'Убрать из избранного' : 'В избранное'}
                    aria-pressed={isFav}
                    aria-label={isFav ? 'Убрать из избранного' : 'Добавить в избранное'}
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleFavorite(s.id)
                    }}
                  >
                    {isFav ? '★' : '☆'}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </PortalDropdown>
  )
}
