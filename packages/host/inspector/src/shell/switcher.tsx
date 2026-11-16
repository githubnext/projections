import {useEffect, useId, useLayoutEffect, useMemo, useRef, useState} from 'react'
import type {ReactNode, RefObject} from 'react'
import {Button, ScopedRoot, ToolbarButton, cn} from '@githubnext/projections-host/ui/components'
import {Check, ChevronDown, CircleAlert, CircleCheck, LoaderCircle, Search, ShieldAlert} from 'lucide-react'

/** Where a projection stands in this session: both sides extracted, one failed, waiting for trust, or extracting. */
export type ProjectionStatus = 'ok' | 'failed' | 'trust' | 'running'

/** One projection the switcher offers. */
export interface SwitcherItem {
  id: string
  title: string
  status?: ProjectionStatus | undefined
}

const statuses: Record<ProjectionStatus, {text: string; icon: (className: string) => ReactNode}> = {
  ok: {text: 'OK', icon: className => <CircleCheck className={cn(className, 'pj:text-added')} />},
  failed: {text: 'Failed', icon: className => <CircleAlert className={cn(className, 'pj:text-destructive')} />},
  trust: {text: 'Needs trust', icon: className => <ShieldAlert className={cn(className, 'pj:text-modified')} />},
  running: {
    text: 'Extracting',
    icon: className => <LoaderCircle className={cn(className, 'pj:animate-spin pj:text-muted-foreground pj:motion-reduce:animate-none')} />,
  },
}

/** The words for a status, for accessible names and tooltips. */
export const statusText = (status: ProjectionStatus) => statuses[status].text

/**
 * A projection's status as a dot: an icon whose shape says it (a check, an alert, a shield, a spinner) with its
 * words for assistive technology and as a tooltip, never color alone.
 */
export function StatusDot({status, label = false}: {status: ProjectionStatus | undefined; label?: boolean}) {
  if (!status) return <span aria-hidden="true" className="pi-dot pj:inline-flex pj:size-3.5 pj:shrink-0" />
  const {text, icon} = statuses[status]
  return (
    <span
      className="pi-dot pj:inline-flex pj:shrink-0 pj:items-center pj:gap-1 pj:text-[11px] pj:text-muted-foreground"
      data-status={status}
      title={text}
    >
      <span aria-hidden="true" className="pj:inline-flex">
        {icon('pj:size-3.5')}
      </span>
      {label ? text : <span className="pj:sr-only">{text}</span>}
    </span>
  )
}

function matches(item: SwitcherItem, query: string): boolean {
  const haystack = `${item.title} ${item.id}`.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every(word => haystack.includes(word))
}

const sheetQuery = '(max-width: 639.98px)'

/**
 * The projection switcher, the title bar's document title: the current projection's title and a chevron, with a
 * count of the other projections that are failing. It opens (by click, Enter, Space, Arrow Down or ⌘P / Ctrl+P) a
 * popup under it, a sheet on phones: a combobox that filters every projection by title or ID as you type, over a
 * listbox of them with their IDs and statuses, the current one checked. Arrow keys move, Enter switches, Escape
 * closes; focus returns to where it was.
 */
export function ProjectionSwitcher({
  items,
  current,
  open,
  onOpenChange,
  onChoose,
  colorMode,
  shortcut,
  empty = 'No projection',
}: {
  items: readonly SwitcherItem[]
  current: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onChoose: (id: string) => void
  colorMode: 'light' | 'dark'
  /** The shortcut that opens it, for the tooltip, for example `⌘P`. */
  shortcut?: string
  /** What the trigger says when there is no projection. */
  empty?: string
}) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const selected = items.find(item => item.id === current)
  const title = selected?.title ?? empty
  const failing = items.filter(item => item.id !== current && item.status === 'failed')
  const failingText = failing.length ? `${failing.length} failing` : ''
  const name = `Projection: ${title}${failing.length ? `, ${failing.length} other ${failing.length === 1 ? 'projection' : 'projections'} failing` : ''}`
  const tooltip = [
    `${title}${selected ? ` (${selected.id})` : ''}`,
    failing.length ? `Failing: ${failing.map(item => item.title).join(', ')}` : '',
    shortcut ? `Switch projection (${shortcut})` : '',
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <>
      <ToolbarButton asChild>
        <Button
          ref={trigger}
          type="button"
          variant="ghost"
          size="sm"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? `${id}-dialog` : undefined}
          aria-label={name}
          title={tooltip}
          disabled={!items.length}
          data-toolbar-region="switcher"
          data-failing={failing.length || undefined}
          className="pi-switcher pj:h-8 pj:min-w-0 pj:max-w-full pj:gap-1.5 pj:px-2.5 pj:text-[13px] pj:font-semibold pj:tracking-tight pj:text-foreground pj:aria-expanded:bg-accent"
          onClick={() => onOpenChange(!open)}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' && !open) {
              event.preventDefault()
              onOpenChange(true)
            }
          }}
        >
          <span className="pi-switcher-title pj:min-w-0 pj:truncate">{title}</span>
          {failing.length > 0 && (
            <span className="pi-failing pj:inline-flex pj:shrink-0 pj:items-center pj:gap-1 pj:text-[11px] pj:font-normal pj:text-muted-foreground">
              <CircleAlert aria-hidden="true" className="pj:size-3.5 pj:text-destructive" />
              {failingText}
            </span>
          )}
          <ChevronDown aria-hidden="true" className="pj:size-3.5 pj:shrink-0 pj:text-muted-foreground" />
        </Button>
      </ToolbarButton>
      {open && (
        <SwitcherPopup
          id={`${id}-dialog`}
          items={items}
          current={current}
          trigger={trigger}
          colorMode={colorMode}
          onClose={() => onOpenChange(false)}
          onChoose={item => {
            onOpenChange(false)
            if (item !== current) onChoose(item)
          }}
        />
      )}
    </>
  )
}

/**
 * The switcher's popup, under its trigger (centred, or from its start), a sheet on phones: a search over the list of
 * projections, the current one checked. The agent viewer's title opens it too (viewer/title.tsx).
 */
export function SwitcherPopup({
  id,
  items,
  current,
  trigger,
  colorMode,
  onClose,
  onChoose,
  align = 'center',
}: {
  id: string
  items: readonly SwitcherItem[]
  current: string
  trigger: RefObject<HTMLButtonElement | null>
  colorMode: 'light' | 'dark'
  onClose: () => void
  onChoose: (id: string) => void
  align?: 'center' | 'start'
}) {
  const [query, setQuery] = useState('')
  const shown = useMemo(() => items.filter(item => matches(item, query)), [items, query])
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      items.findIndex(item => item.id === current),
    ),
  )
  const input = useRef<HTMLInputElement>(null)
  const [sheet] = useState(() => typeof matchMedia === 'function' && matchMedia(sheetQuery).matches)
  const [anchor, setAnchor] = useState<{top: number; center: number; start: number} | undefined>()

  useLayoutEffect(() => {
    const box = trigger.current?.getBoundingClientRect()
    if (box) setAnchor({top: box.bottom + 4, center: box.left + box.width / 2, start: box.left})
  }, [trigger])
  useEffect(() => {
    const returnFocus = document.activeElement as HTMLElement | null
    const button = trigger.current
    requestAnimationFrame(() => input.current?.focus())
    return () => {
      // Back to where focus was: the trigger, or wherever ⌘P was pressed.
      ;(returnFocus && returnFocus !== document.body ? returnFocus : button)?.focus?.()
    }
  }, [trigger])
  // Escape closes it wherever focus is (focus moves into the search a frame after it opens; a tap may leave it outside).
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      close.current()
    }
    document.addEventListener('keydown', keyDown)
    return () => document.removeEventListener('keydown', keyDown)
  }, [])
  useEffect(() => {
    document.getElementById(`${id}-option-${index}`)?.scrollIntoView({block: 'nearest'})
  }, [id, index])

  const width = 384
  const left = anchor
    ? Math.max(8, Math.min(innerWidth - width - 8, align === 'start' ? anchor.start : anchor.center - width / 2))
    : undefined
  return (
    <ScopedRoot colorMode={colorMode} className="pi-switcher-layer">
      <div
        className={cn('pj:fixed pj:inset-0 pj:z-[90]', sheet && 'pj:bg-black/40')}
        onMouseDown={event => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        <div
          id={id}
          role="dialog"
          aria-modal="true"
          aria-label="Switch projection"
          data-sheet={sheet || undefined}
          className={cn(
            'pi-switcher-popup pj:fixed pj:flex pj:flex-col pj:overflow-hidden pj:rounded-lg pj:border pj:bg-popover pj:text-popover-foreground pj:shadow-pop pj:inset-shadow-bevel',
            sheet ? 'pj:inset-x-2 pj:top-11 pj:max-h-[min(32rem,75dvh)]' : 'pj:max-h-[min(28rem,70dvh)]',
          )}
          style={sheet ? undefined : {top: anchor?.top ?? 44, left: left ?? `calc(50% - ${width / 2}px)`, width}}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              onClose()
            } else if (event.key === 'ArrowDown') {
              event.preventDefault()
              setIndex(value => (shown.length ? (value + 1) % shown.length : 0))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setIndex(value => (shown.length ? (value - 1 + shown.length) % shown.length : 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              const item = shown[index]
              if (item) onChoose(item.id)
            } else if (event.key === 'Tab') event.preventDefault()
          }}
        >
          <div className="pj:flex pj:items-center pj:gap-2 pj:border-b pj:px-3">
            <Search aria-hidden="true" className="pj:size-4 pj:shrink-0 pj:text-muted-foreground" />
            <input
              ref={input}
              role="combobox"
              aria-expanded="true"
              aria-autocomplete="list"
              aria-controls={`${id}-list`}
              aria-activedescendant={shown.length ? `${id}-option-${index}` : undefined}
              aria-label="Find a projection"
              placeholder="Find a projection by title or ID"
              value={query}
              onChange={event => {
                setQuery(event.target.value)
                setIndex(0)
              }}
              autoComplete="off"
              spellCheck={false}
              data-focus-ring="none"
              className="pj:h-10 pj:w-full pj:bg-transparent pj:text-sm pj:placeholder:text-muted-foreground pj:focus:outline-hidden"
            />
          </div>
          <ul id={`${id}-list`} role="listbox" aria-label="Projections" className="pj:min-h-0 pj:flex-1 pj:overflow-y-auto pj:p-1">
            {!shown.length && (
              <li role="presentation" className="pj:px-3 pj:py-6 pj:text-center pj:text-sm pj:text-muted-foreground">
                No matching projection.
              </li>
            )}
            {shown.map((item, position) => {
              const isCurrent = item.id === current
              return (
                <li
                  key={item.id}
                  id={`${id}-option-${position}`}
                  role="option"
                  aria-selected={position === index}
                  aria-current={isCurrent ? 'true' : undefined}
                  aria-label={`${item.title}, ${item.id}${item.status ? `, ${statusText(item.status)}` : ''}${isCurrent ? ', current' : ''}`}
                  data-projection={item.id}
                  data-status={item.status}
                  onMouseMove={() => setIndex(position)}
                  onClick={() => onChoose(item.id)}
                  className={cn(
                    'pj:flex pj:min-h-10 pj:cursor-pointer pj:items-center pj:gap-2 pj:rounded-md pj:px-2 pj:py-1',
                    position === index && 'pj:bg-accent pj:text-accent-foreground',
                  )}
                >
                  <span aria-hidden="true" className="pj:inline-flex pj:size-4 pj:shrink-0 pj:items-center pj:justify-center">
                    {isCurrent && <Check className="pj:size-4" />}
                  </span>
                  <span className="pj:flex pj:min-w-0 pj:flex-1 pj:flex-col">
                    <span className="pj:truncate pj:text-sm pj:font-medium">{item.title}</span>
                    <code className="pj:truncate pj:font-mono pj:text-[11px] pj:text-muted-foreground">{item.id}</code>
                  </span>
                  <StatusDot status={item.status} label />
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </ScopedRoot>
  )
}
