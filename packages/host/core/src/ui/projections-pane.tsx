import {useLayoutEffect, useRef} from 'react'
import type {ReactNode} from 'react'
import {X} from 'lucide-react'
import {Button} from './components/button.js'
import {cn} from './lib/utils.js'

/** The pane's width, CSS px. */
export const paneWidth = 240
/** Its header's height, CSS px, with its bottom edge: the toolbar's row, so the two read as one band. */
export const paneHeaderHeight = 41

/** A projection the pane lists: its ID, its title, a short secondary line (a change count, an ID) and a status mark. */
export interface ProjectionsPaneItem {
  id: string
  title: string
  detail?: ReactNode
  status?: ReactNode
}

/**
 * The projections list as a durable pane at the page's start (`usePinnedPane`), instead of the projection menu: a
 * "Projections" navigation landmark, its header's close button (`onClose`, which returns to the menu), and each
 * projection as a button, the current one marked `aria-current="page"`, and an optional `footer`. Focus moves to the
 * current item when it opens with `autoFocus` (the person pinned it, not a reload), or when `autoFocus` turns on later. It draws its own edge at its end,
 * `paneWidth` wide, on the toolbar's surface; its header is `paneHeaderHeight` tall, the toolbar's row.
 */
export function ProjectionsPane({
  items,
  current,
  onChoose,
  onClose,
  label = 'Projections',
  autoFocus = false,
  footer,
  className,
}: {
  items: readonly ProjectionsPaneItem[]
  current: string | undefined
  /** Shows another projection; absent while nothing can switch (the pane lists them only). */
  onChoose?: ((id: string) => void) | undefined
  onClose: () => void
  label?: string
  /** Moves focus to the current projection when the pane opens with it (the person pinned it), or when it turns on. */
  autoFocus?: boolean
  /** What follows the list, at the pane's foot (a surface's own command, such as its collection details). */
  footer?: ReactNode
  className?: string
}) {
  const list = useRef<HTMLUListElement>(null)
  useLayoutEffect(() => {
    const scroller = list.current
    const item = scroller?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!scroller || !item) return
    // The current projection in view in the list, however long, without scrolling the page; then focus, if asked.
    const box = scroller.getBoundingClientRect(),
      row = item.getBoundingClientRect()
    if (row.bottom > box.bottom) scroller.scrollTop += row.bottom - box.bottom
    else if (row.top < box.top) scroller.scrollTop -= box.top - row.top
  }, [])
  // Focus on the current projection whenever `autoFocus` turns on: when it opens with it, or once it is shown.
  useLayoutEffect(() => {
    if (autoFocus) list.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus({preventScroll: true})
  }, [autoFocus])
  return (
    <nav
      aria-label={label}
      className={cn(
        'ph-projections-pane pj:flex pj:min-h-0 pj:shrink-0 pj:flex-col pj:border-r pj:border-divider pj:bg-surface-header pj:text-foreground',
        className,
      )}
      style={{width: paneWidth}}
    >
      <div
        className="pj:flex pj:shrink-0 pj:items-center pj:justify-between pj:gap-2 pj:border-b pj:border-divider pj:pr-1.5 pj:pl-3"
        style={{height: paneHeaderHeight}}
      >
        <h2 className="pj:m-0 pj:text-xs pj:font-semibold pj:text-muted-foreground">{label}</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close projections pane"
          title="Close projections pane"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <ul ref={list} className="pj:m-0 pj:flex pj:min-h-0 pj:flex-1 pj:list-none pj:flex-col pj:gap-0.5 pj:overflow-y-auto pj:p-1">
        {items.map(item => {
          const isCurrent = item.id === current
          return (
            <li key={item.id}>
              <button
                type="button"
                data-projection={item.id}
                aria-current={isCurrent ? 'page' : undefined}
                disabled={!onChoose}
                onClick={() => !isCurrent && onChoose?.(item.id)}
                className={cn(
                  'pj:flex pj:w-full pj:min-w-0 pj:items-center pj:gap-2 pj:rounded-md pj:px-2 pj:py-1.5 pj:text-left pj:outline-hidden pj:focus-visible:ring-2 pj:focus-visible:ring-ring',
                  isCurrent ? 'pj:bg-accent pj:text-accent-foreground' : 'pj:hover:bg-accent/60',
                  'pj:disabled:cursor-default',
                )}
              >
                <span className="pj:flex pj:min-w-0 pj:flex-1 pj:flex-col">
                  <span className={cn('pj:truncate pj:text-sm', isCurrent ? 'pj:font-semibold' : 'pj:font-medium')} title={item.title}>
                    {item.title}
                  </span>
                  {item.detail !== undefined && <span className="pj:truncate pj:text-xs pj:text-muted-foreground">{item.detail}</span>}
                </span>
                {item.status}
              </button>
            </li>
          )
        })}
      </ul>
      {footer && <div className="pj:shrink-0 pj:border-t pj:border-divider pj:p-1">{footer}</div>}
    </nav>
  )
}
