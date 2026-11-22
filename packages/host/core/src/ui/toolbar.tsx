import {createContext, useCallback, useState} from 'react'
import type {KeyboardEventHandler, ReactNode, Ref} from 'react'
import {Ellipsis} from 'lucide-react'
import {cn} from './lib/utils.js'
import {ToolbarPopover} from './toolbar-popover.js'

/** Closes the enclosing `MoreMenu`, for example once a person picks a view in it. */
export const MoreContext = createContext<(() => void) | null>(null)

/** Calls `close` when a click (or Enter or Space) lands on an element with `role`. */
export const closeOn = (role: string, close: (() => void) | null) => (event: {target: EventTarget}) => {
  if (close && event.target instanceof Element && event.target.closest(`[role="${role}"]`)) close()
}

/**
 * The toolbar's overflow: a "More" button whose popover (a dialog named "More") holds blocks that don't fit the
 * row, such as the zoom actions, the filter field, About and full screen. Choosing a view or full screen in it
 * closes it.
 */
export function MoreMenu({children}: {children: ReactNode}) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  return (
    <ToolbarPopover
      icon={<Ellipsis />}
      label="More"
      title="More"
      className="ph-more"
      contentClassName="pj:w-72 pj:max-h-[min(32rem,var(--radix-popover-content-available-height))] pj:overflow-y-auto"
      open={open}
      onOpenChange={setOpen}
    >
      <MoreContext value={close}>
        <div className="pj:flex pj:min-w-0 pj:flex-col pj:gap-3">{children}</div>
      </MoreContext>
    </ToolbarPopover>
  )
}

/** A labeled section of a `MoreMenu`. */
export function MoreSection({label, children}: {label: string; children: ReactNode}) {
  return (
    <section aria-label={label} className="pj:flex pj:min-w-0 pj:flex-col pj:gap-1.5">
      <p aria-hidden="true" className="pj:text-xs pj:font-medium pj:text-muted-foreground">
        {label}
      </p>
      <div className="pj:flex pj:min-w-0 pj:flex-wrap pj:items-center pj:gap-1">{children}</div>
    </section>
  )
}

/**
 * The toolbar the prebuilt views use, a group named "Projection toolbar": a band of the header's surface, edge to edge,
 * ruled off below by a hairline. It holds one line of blocks, or with `rows` a stack of `ToolbarRow`s (the prebuilt
 * views plan one row, or a second row for playback; they never wrap). `ref` reaches the toolbar, for example to measure
 * it. With `onKeyDown` (for example `spaceTogglesPlayback`) the toolbar takes focus when its background is clicked, so
 * the handler hears keys pressed there too.
 */
export function Toolbar({
  children,
  className,
  ref,
  onKeyDown,
  rows = false,
}: {
  children: ReactNode
  className?: string
  ref?: Ref<HTMLDivElement>
  onKeyDown?: KeyboardEventHandler<HTMLElement> | undefined
  rows?: boolean
}) {
  return (
    <div
      ref={ref}
      role="group"
      aria-label="Projection toolbar"
      {...(onKeyDown ? {onKeyDown, tabIndex: -1} : {})}
      data-fit={rows ? 'column' : 'row'}
      className={cn(
        'ph-toolbar pj:flex pj:min-w-0 pj:shrink-0 pj:overflow-hidden pj:border-b pj:border-divider pj:bg-surface-header pj:p-1 pj:text-foreground pj:focus-visible:outline-hidden',
        rows ? 'pj:flex-col pj:items-stretch pj:gap-1' : 'pj:flex-nowrap pj:items-center pj:gap-1.5',
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * One planned line of a `rows` `Toolbar`: blocks in a row that never wraps. A `centred` row holds three blocks and
 * centres the middle one on the whole row, the first at its start and the last at its end; the blocks beside it get
 * equal halves of what is left, so each is laid out within its half.
 */
export function ToolbarRow({children, className, centred = false}: {children: ReactNode; className?: string; centred?: boolean}) {
  return (
    <div
      data-fit={centred ? 'centre' : 'row'}
      data-centred={centred || undefined}
      className={cn(
        'ph-toolbar-row pj:min-w-0 pj:items-center pj:gap-1.5',
        centred ? 'pj:grid pj:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]' : 'pj:flex pj:flex-nowrap',
        className,
      )}
    >
      {children}
    </div>
  )
}
