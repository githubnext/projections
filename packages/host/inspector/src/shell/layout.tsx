import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {Badge, cn} from '@githubnext/projections-host/ui/components'
import {X} from 'lucide-react'
import {iconButton, shortcutLabel} from './controls.js'

/** A tab of the bottom panel. */
export interface PanelTab {
  id: string
  label: string
  /** A count shown beside the label, for example errors. */
  badge?: number | undefined
  /** Tone of the badge. */
  tone?: 'default' | 'destructive'
  content: ReactNode
}

export interface Layout {
  sidebar: boolean
  sidebarWidth: number
  panel: boolean
  panelHeight: number
  /** The docked panel on the right of the stage (the Inspector's Details). */
  secondary: boolean
  secondaryWidth: number
}

const storageKey = 'projections-inspector-layout'
const defaults: Layout = {sidebar: true, sidebarWidth: 288, panel: false, panelHeight: 260, secondary: false, secondaryWidth: 320}
export const limits = {sidebar: [180, 520], panel: [120, 640], secondary: [240, 640]} as const
export const clamp = (value: number, [low, high]: readonly [number, number]) => Math.round(Math.max(low, Math.min(high, value)))
const narrowQuery = '(max-width: 1011.98px)'
const isNarrow = () => typeof matchMedia === 'function' && matchMedia(narrowQuery).matches

/**
 * The layout, persisted per browser and per kind of sidebar (`scope`): the sidebar, panel and docked panel sizes, and
 * whether the sidebar (`sidebar` until someone chooses) and the docked panel are open. Below the drawer width both
 * start closed, and opening them there (as sheets) isn't remembered.
 */
export function useLayout(scope: string, sidebar = defaults.sidebar): [Layout, (update: Partial<Layout>) => void] {
  const key = `${storageKey}:${scope}`
  const [layout, setLayout] = useState<Layout>(() => {
    let saved: Partial<Layout> = {}
    try {
      saved = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<Layout>
    } catch {
      /* unavailable or malformed */
    }
    return {
      sidebar: (typeof saved.sidebar === 'boolean' ? saved.sidebar : sidebar) && !isNarrow(),
      sidebarWidth: clamp(Number(saved.sidebarWidth) || defaults.sidebarWidth, limits.sidebar),
      panel: defaults.panel,
      panelHeight: clamp(Number(saved.panelHeight) || defaults.panelHeight, limits.panel),
      secondary: (typeof saved.secondary === 'boolean' ? saved.secondary : defaults.secondary) && !isNarrow(),
      secondaryWidth: clamp(Number(saved.secondaryWidth) || defaults.secondaryWidth, limits.secondary),
    }
  })
  const update = useCallback(
    (next: Partial<Layout>) =>
      setLayout(current => {
        const merged = {...current, ...next}
        try {
          const saved = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<Layout>
          const persisted = {
            sidebar: isNarrow() ? (saved.sidebar ?? sidebar) : merged.sidebar,
            sidebarWidth: merged.sidebarWidth,
            panelHeight: merged.panelHeight,
            secondary: isNarrow() ? (saved.secondary ?? defaults.secondary) : merged.secondary,
            secondaryWidth: merged.secondaryWidth,
          }
          localStorage.setItem(key, JSON.stringify(persisted))
        } catch {
          /* storage may be unavailable */
        }
        return merged
      }),
    [key, sidebar],
  )
  return [layout, update]
}

/** Whether the viewport is narrow enough that the sidebar and panel float over the content. */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(isNarrow)
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined
    const list = matchMedia(narrowQuery)
    const changed = () => setNarrow(list.matches)
    list.addEventListener('change', changed)
    return () => list.removeEventListener('change', changed)
  }, [])
  return narrow
}

/**
 * A drag handle in the gutter between two cards; arrow keys resize too. It takes no room of its own: it lies over the
 * gutter on the side of the card it resizes (`edge`: the card is before it, `after`; or after it, `before`), and shows
 * a line there while hovered, focused or dragged. `value` grows to the right (a card before it), to the left (after
 * it) or upwards (a horizontal one, under its card's top edge).
 */
export function Splitter({
  orientation,
  edge = 'after',
  label,
  value,
  onChange,
}: {
  orientation: 'vertical' | 'horizontal'
  edge?: 'after' | 'before'
  label: string
  value: number
  onChange: (value: number) => void
}) {
  const start = useRef<{pointer: number; value: number} | undefined>(undefined)
  const [dragging, setDragging] = useState(false)
  const vertical = orientation === 'vertical'
  // Growing with the pointer: right for a card before the handle, left for one after it, up for a bottom panel.
  const sign = vertical ? (edge === 'after' ? 1 : -1) : -1
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return
    const delta = (vertical ? event.clientX : event.clientY) - start.current.pointer
    onChange(start.current.value + sign * delta)
  }
  const key = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16
    const grow: Record<string, number> = vertical ? {ArrowRight: sign * step, ArrowLeft: -sign * step} : {ArrowUp: step, ArrowDown: -step}
    const delta = grow[event.key]
    if (delta !== undefined && delta !== 0) {
      event.preventDefault()
      onChange(value + delta)
    }
  }
  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={value}
      tabIndex={0}
      data-dragging={dragging || undefined}
      className={cn(
        'pi-splitter pj:relative pj:z-10 pj:shrink-0 pj:touch-none pj:focus-visible:outline-hidden',
        vertical
          ? cn('pj:w-[var(--pi-gutter)] pj:cursor-col-resize', edge === 'after' ? 'pj:-mr-[var(--pi-gutter)]' : 'pj:-ml-[var(--pi-gutter)]')
          : 'pj:-mt-[var(--pi-gutter)] pj:h-[var(--pi-gutter)] pj:cursor-row-resize',
      )}
      onPointerDown={event => {
        start.current = {pointer: vertical ? event.clientX : event.clientY, value}
        setDragging(true)
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={move}
      onPointerUp={() => {
        start.current = undefined
        setDragging(false)
      }}
      onPointerCancel={() => {
        start.current = undefined
        setDragging(false)
      }}
      onKeyDown={key}
    />
  )
}

/** The sidebar card, with its resize handle; below the drawer width, a sheet over the view that its scrim closes. */
export function Sidebar({
  label,
  narrow,
  width,
  onResize,
  onClose,
  children,
}: {
  label: string
  narrow: boolean
  width: number
  onResize: (value: number) => void
  onClose: () => void
  children: ReactNode
}) {
  return (
    <>
      {narrow && <div aria-hidden="true" className="pi-scrim pj:absolute pj:inset-0 pj:z-20 pj:bg-background/60" onClick={onClose} />}
      <aside
        aria-label={label}
        className={cn(
          'pi-sidebar pi-card pj:flex pj:min-h-0 pj:flex-col',
          narrow
            ? 'pi-sheet pj:absolute pj:inset-y-[var(--pi-gutter)] pj:left-[var(--pi-gutter)] pj:z-30 pj:w-[min(20rem,calc(100vw-3rem))] pj:shadow-pop'
            : 'pj:my-[var(--pi-gutter)] pj:ml-[var(--pi-gutter)] pj:shrink-0',
        )}
        style={narrow ? undefined : {width}}
      >
        {children}
      </aside>
      {!narrow && <Splitter orientation="vertical" label="Resize sidebar" value={width} onChange={onResize} />}
    </>
  )
}

/** The bottom panel card: its resize handle, its tabs (arrow keys move between them) and the active tab's content. */
export function BottomPanel({
  tabs,
  active,
  narrow,
  height,
  onResize,
  onTab,
  onClose,
}: {
  tabs: readonly PanelTab[]
  active: PanelTab
  narrow: boolean
  height: number
  onResize: (value: number) => void
  onTab: (id: string) => void
  onClose: () => void
}) {
  return (
    <>
      {!narrow && <Splitter orientation="horizontal" label="Resize panel" value={height} onChange={onResize} />}
      <section
        aria-label="Panel"
        className={cn(
          'pi-panel pi-card pj:flex pj:min-h-0 pj:flex-col',
          narrow
            ? 'pi-sheet pj:absolute pj:inset-x-[var(--pi-gutter)] pj:bottom-[var(--pi-gutter)] pj:z-30 pj:h-[60%] pj:shadow-pop'
            : 'pj:mx-[var(--pi-gutter)] pj:mb-[var(--pi-gutter)] pj:shrink-0',
        )}
        style={narrow ? undefined : {height}}
      >
        <div
          role="tablist"
          aria-label="Panel views"
          className="pi-panel-tabs pj:flex pj:h-9 pj:shrink-0 pj:items-center pj:gap-0.5 pj:overflow-x-auto pj:px-1.5"
        >
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`pi-panel-tab-${tab.id}`}
              aria-selected={tab.id === active.id}
              aria-controls="pi-panel-content"
              tabIndex={tab.id === active.id ? 0 : -1}
              onClick={() => onTab(tab.id)}
              onKeyDown={event => {
                const index = tabs.indexOf(tab)
                const next =
                  event.key === 'ArrowRight'
                    ? tabs[(index + 1) % tabs.length]
                    : event.key === 'ArrowLeft'
                      ? tabs[(index - 1 + tabs.length) % tabs.length]
                      : undefined
                if (next) {
                  event.preventDefault()
                  onTab(next.id)
                  document.getElementById(`pi-panel-tab-${next.id}`)?.focus()
                }
              }}
              className="pj:inline-flex pj:h-6 pj:shrink-0 pj:items-center pj:gap-1.5 pj:rounded-sm pj:px-2 pj:text-[11px] pj:font-medium pj:text-muted-foreground pj:transition-colors pj:hover:text-foreground pj:focus-visible:outline-hidden pj:focus-visible:ring-1 pj:focus-visible:ring-ring pj:aria-selected:bg-accent pj:aria-selected:text-foreground"
            >
              {tab.label}
              {tab.badge !== undefined && tab.badge !== 0 ? (
                <Badge
                  variant={tab.tone === 'destructive' ? 'destructive' : 'secondary'}
                  className="pj:h-4 pj:min-w-4 pj:justify-center pj:px-1 pj:py-0 pj:text-[10px]"
                >
                  {tab.badge}
                </Badge>
              ) : null}
            </button>
          ))}
          <button type="button" className={cn(iconButton, 'pj:ml-auto pj:h-6 pj:w-6')} aria-label="Close panel" onClick={onClose}>
            <X className="pj:h-3.5 pj:w-3.5" />
          </button>
        </div>
        <div
          id="pi-panel-content"
          role="tabpanel"
          aria-labelledby={`pi-panel-tab-${active.id}`}
          tabIndex={0}
          className="pj:min-h-0 pj:flex-1 pj:overflow-auto pj:px-3 pj:pb-3 pj:pt-1 pj:focus-visible:outline-hidden"
        >
          {active.content}
        </div>
      </section>
    </>
  )
}

/** The docked card on the right of the stage, with its resize handle; below the drawer width, a sheet that its scrim closes. */
export function SecondarySidebar({
  label,
  actions,
  narrow,
  width,
  onResize,
  onClose,
  children,
}: {
  label: string
  actions?: ReactNode
  narrow: boolean
  width: number
  onResize: (value: number) => void
  onClose: () => void
  children: ReactNode
}) {
  return (
    <>
      {narrow ? (
        <div aria-hidden="true" className="pi-scrim pj:absolute pj:inset-0 pj:z-20 pj:bg-background/60" onClick={onClose} />
      ) : (
        <Splitter orientation="vertical" edge="before" label={`Resize ${label.toLowerCase()} panel`} value={width} onChange={onResize} />
      )}
      <aside
        aria-label={label}
        className={cn(
          'pi-secondary pi-card pj:flex pj:min-h-0 pj:flex-col',
          narrow
            ? 'pi-sheet pj:absolute pj:inset-y-[var(--pi-gutter)] pj:right-[var(--pi-gutter)] pj:z-30 pj:w-[min(22rem,calc(100vw-3rem))] pj:shadow-pop'
            : 'pj:my-[var(--pi-gutter)] pj:mr-[var(--pi-gutter)] pj:shrink-0',
        )}
        style={narrow ? undefined : {width}}
      >
        <div className="pi-card-header pj:flex pj:h-9 pj:shrink-0 pj:items-center pj:gap-1 pj:pl-3 pj:pr-1.5">
          <h2 className="pj:min-w-0 pj:flex-1 pj:truncate pj:text-[11px] pj:font-semibold pj:text-muted-foreground">{label}</h2>
          {actions}
          <button
            type="button"
            className={cn(iconButton, 'pj:h-6 pj:w-6')}
            aria-label={`Close ${label.toLowerCase()} panel`}
            title={`Close (${shortcutLabel('b', {alt: true})})`}
            onClick={onClose}
          >
            <X className="pj:h-3.5 pj:w-3.5" />
          </button>
        </div>
        <div className="pi-secondary-body pj:min-h-0 pj:flex-1 pj:overflow-auto">{children}</div>
      </aside>
    </>
  )
}
