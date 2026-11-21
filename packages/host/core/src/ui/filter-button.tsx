import {useCallback, useEffect, useId, useRef, useState} from 'react'
import {ListFilter, Search} from 'lucide-react'
import type {ProjectionController} from '../projection.js'
import {Button} from './components/button.js'
import {Input} from './components/input.js'
import {Label} from './components/label.js'
import {cn} from './lib/utils.js'
import {ToolbarPopover} from './toolbar-popover.js'

/**
 * A Filter button that expands into the "Filter rows" find field (and stays expanded while a query applies), with the
 * number of matching rows. Escape clears the query, then collapses the field back to the button. `inline` always
 * shows the field, for example in an overflow menu, where Escape on an empty field closes the menu. `popover` opens
 * the field in a popover under the button instead, for rows without room for it (a dot marks an applied query);
 * it is read when the button is pressed, so a field already expanded in the row stays there.
 */
export function FilterButton({
  projection: p,
  inline = false,
  popover = false,
  open: controlledOpen,
  onOpenChange,
  canExpand,
}: {
  projection: ProjectionController
  inline?: boolean
  popover?: boolean
  /**
   * Controlled open state. A view whose toolbar re-plans its layout keeps it,
   * so the field stays open when the Filter block moves (for example from
   * the row into a popover).
   */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /**
   * Whether the row has room for the field right now. When it hasn't, the
   * field opens in a popover instead of expanding in the row, so opening it
   * never makes the row re-plan and move the Filter block away.
   */
  canExpand?: () => boolean
}) {
  const id = useId()
  const [ownOpen, setOwnOpen] = useState(false)
  // Chosen when the field opens from the button: in the row when it fits, else in a popover, which then keeps its
  // trigger (and returns focus to it) until the next time the field opens from the row's button.
  const [asPopover, setAsPopover] = useState(false)
  const open = controlledOpen ?? ownOpen
  const setOpen = useCallback(
    (next: boolean) => {
      setOwnOpen(next)
      onOpenChange?.(next)
    },
    [onOpenChange],
  )
  const input = useRef<HTMLInputElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const refocus = useRef<'input' | 'button' | undefined>(undefined)
  const active = p.search.trim() !== ''
  // In a popover, `open` opens the popover; in the row it expands the field.
  const inPopover = popover || asPopover
  const expanded = inline || (!inPopover && (open || active))
  useEffect(() => {
    if (refocus.current === 'input') input.current?.focus()
    if (refocus.current === 'button') button.current?.focus()
    refocus.current = undefined
  }, [expanded])
  const collapse = useCallback(
    (focusButton: boolean) => {
      refocus.current = focusButton ? 'button' : undefined
      setOpen(false)
    },
    [setOpen],
  )
  const count = `${p.visibleRows.length.toLocaleString()} of ${p.rows.length.toLocaleString()} rows${active ? ' match' : ''}`
  if (!expanded && inPopover) {
    return (
      <ToolbarPopover
        icon={<ListFilter />}
        label="Filter"
        title="Filter"
        className="ph-filter"
        contentClassName="pj:w-72 pj:p-2"
        active={active}
        activeLabel="Filter applied"
        open={open}
        onOpenChange={setOpen}
      >
        {field(true)}
      </ToolbarPopover>
    )
  }
  if (!expanded) {
    return (
      <Button
        ref={button}
        type="button"
        variant="ghost"
        size="icon-sm"
        className="ph-filter pj:shrink-0 pj:text-muted-foreground pj:hover:text-foreground"
        aria-label="Filter"
        title="Filter rows"
        aria-expanded={false}
        onClick={() => {
          refocus.current = 'input'
          setAsPopover(Boolean(canExpand && !canExpand()))
          setOpen(true)
        }}
      >
        <ListFilter />
      </Button>
    )
  }
  return field(false)
  function field(inPopover: boolean) {
    const full = inline || inPopover
    return (
      <div className={cn('ph-filter pj:relative pj:flex pj:min-w-0 pj:items-center', full ? 'pj:w-full' : 'pj:w-56 pj:shrink-0')}>
        <Label htmlFor={`${id}-search`} className="pj:sr-only">
          Filter rows
        </Label>
        <Search
          aria-hidden="true"
          className="pj:pointer-events-none pj:absolute pj:left-2.5 pj:top-1/2 pj:size-4 pj:-translate-y-1/2 pj:text-muted-foreground"
        />
        <Input
          ref={input}
          id={`${id}-search`}
          type="search"
          value={p.search}
          placeholder="Filter rows"
          aria-describedby={`${id}-count`}
          className={cn('pj:h-8 pj:bg-background pj:pl-8 pj:md:text-sm', active && 'pj:pr-14')}
          onChange={event => p.setSearch(event.target.value)}
          onKeyDown={event => {
            if (event.key !== 'Escape' || (full && !p.search)) return
            event.preventDefault()
            event.stopPropagation()
            if (p.search) p.setSearch('')
            else collapse(true)
          }}
          onBlur={event => {
            if (full || p.search.trim() || event.currentTarget.parentElement?.contains(event.relatedTarget)) return
            // Collapse once the click that moved focus away has landed: the row can rewrap when the field collapses.
            setTimeout(() => {
              if (document.activeElement !== input.current) collapse(false)
            }, 300)
          }}
        />
        {active && (
          <span
            aria-hidden="true"
            className="pj:pointer-events-none pj:absolute pj:right-2.5 pj:text-xs pj:tabular-nums pj:text-muted-foreground"
          >
            {p.visibleRows.length.toLocaleString()}/{p.rows.length.toLocaleString()}
          </span>
        )}
        <span id={`${id}-count`} role="status" className="pj:sr-only">
          {count}
        </span>
      </div>
    )
  }
}
