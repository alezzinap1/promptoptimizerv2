import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Workspace } from '../api/client'
import menuStyles from './DropdownMenu.module.css'
import PortalDropdown from './PortalDropdown'
import styles from './WorkspacePicker.module.css'

const WorkspaceIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
)

type Props = {
  workspaces: Workspace[]
  workspaceId: number
  onSelect: (id: number) => void
}

export default function WorkspacePicker({ workspaces, workspaceId, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const current = workspaces.find((w) => Number(w.id ?? 0) === workspaceId)
  const summary =
    workspaceId === 0 ? 'Без workspace' : current?.name?.trim() || `Workspace #${workspaceId}`

  return (
    <div className={styles.wrap}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        title={summary}
        aria-label={`Workspace: ${summary}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
      >
        <WorkspaceIcon />
      </button>
      <PortalDropdown open={open} onClose={() => setOpen(false)} anchorRef={triggerRef} minWidth={220}>
        <button
          type="button"
          role="option"
          className={`${menuStyles.menuItem} ${workspaceId === 0 ? menuStyles.menuItemActive : ''}`}
          onClick={() => {
            onSelect(0)
            setOpen(false)
          }}
        >
          Без workspace
        </button>
        {workspaces.map((ws) => {
          const id = Number(ws.id ?? 0)
          return (
            <button
              key={`${id}-${ws.name}`}
              type="button"
              role="option"
              className={`${menuStyles.menuItem} ${workspaceId === id ? menuStyles.menuItemActive : ''}`}
              title={ws.description || ws.name}
              onClick={() => {
                onSelect(id)
                setOpen(false)
              }}
            >
              {ws.name}
            </button>
          )
        })}
        <div className={menuStyles.menuDivider} />
        <Link
          to="/workspaces"
          className={`${menuStyles.menuItem} ${menuStyles.menuAddLink}`}
          onClick={() => setOpen(false)}
        >
          Добавить…
        </Link>
      </PortalDropdown>
    </div>
  )
}
