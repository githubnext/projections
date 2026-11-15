import {useId, useState} from 'react'
import type {ReactNode} from 'react'
import {cn} from '@githubnext/projections-host/ui/components'
import {ChevronRight} from 'lucide-react'

/**
 * One collapsible group of the Explorer. The Explorer is a registry of these: a mode lists the sections it has (the
 * current projection's Parts and Compare, fixtures mode's Scenarios and Checks, a saved artifact's revisions), and new
 * ones can join without changing the panel.
 */
export interface ExplorerSection {
  /** Stable ID; the section's open state is remembered by it. */
  id: string
  title: string
  /** Buttons beside the title, for example Cancel or Swap. */
  actions?: ReactNode
  children: ReactNode
  /** Open until someone collapses it (default: open). */
  defaultOpen?: boolean
}

const openKey = (scope: string, id: string) => `projections-inspector-explorer:${scope}:${id}`
function remembered(scope: string, id: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(openKey(scope, id))
    return value === null ? fallback : value === 'open'
  } catch {
    return fallback
  }
}

/**
 * The Explorer: the Inspector's left card, like an editor's. A labelled `nav` landmark of collapsible sections (each
 * a disclosure button and a region), their open state remembered per `scope`. A section's label sits on the card on
 * the spacing system's text column; sections are apart by spacing and an inset rule.
 */
export function Explorer({label, scope, sections}: {label: string; scope: string; sections: readonly ExplorerSection[]}) {
  return (
    <nav aria-label={label} className="pi-explorer pj:flex pj:min-h-0 pj:flex-1 pj:flex-col pj:overflow-y-auto">
      {sections.map(section => (
        <ExplorerGroup key={section.id} scope={scope} section={section} />
      ))}
    </nav>
  )
}

function ExplorerGroup({scope, section}: {scope: string; section: ExplorerSection}) {
  const id = useId()
  const [open, setOpen] = useState(() => remembered(scope, section.id, section.defaultOpen ?? true))
  return (
    <section data-section={section.id} className="pi-explorer-section pj:flex pj:shrink-0 pj:flex-col">
      <div className="pj:sticky pj:top-0 pj:z-10 pj:flex pj:h-8 pj:shrink-0 pj:items-center pj:gap-0.5 pj:bg-surface-canvas pj:pr-1">
        <h2 className="pj:flex pj:min-w-0 pj:flex-1">
          <button
            type="button"
            id={`${id}-title`}
            aria-expanded={open}
            aria-controls={`${id}-body`}
            className="pi-x-header pj:flex pj:h-8 pj:min-w-0 pj:flex-1 pj:items-center pj:text-left pj:text-[11px] pj:font-semibold pj:text-muted-foreground pj:hover:text-foreground pj:focus-visible:outline-hidden pj:focus-visible:ring-1 pj:focus-visible:ring-inset pj:focus-visible:ring-ring"
            onClick={() => {
              setOpen(!open)
              try {
                localStorage.setItem(openKey(scope, section.id), open ? 'closed' : 'open')
              } catch {
                /* storage may be unavailable */
              }
            }}
          >
            <span aria-hidden="true" className="pi-x-icon">
              <ChevronRight className={cn('pj:size-3.5 pj:transition-transform', open && 'pj:rotate-90')} />
            </span>
            <span className="pi-x-title pj:truncate">{section.title}</span>
          </button>
        </h2>
        {open && section.actions}
      </div>
      <div id={`${id}-body`} role="region" aria-labelledby={`${id}-title`} hidden={!open} className="pi-x-body">
        {section.children}
      </div>
    </section>
  )
}

/** A heading inside an Explorer section, for example "Pairs" or "History" in Compare. */
export function ExplorerSubheading({children, actions}: {children: ReactNode; actions?: ReactNode}) {
  return (
    <div className="pi-x-sublabel">
      <h3 className="pj:min-w-0 pj:flex-1 pj:truncate pj:text-[11px] pj:font-medium pj:text-muted-foreground">{children}</h3>
      {actions}
    </div>
  )
}
