import {useId, useMemo, useRef, useState} from 'react'
import type {KeyboardEvent, RefObject} from 'react'
import {VscBadge, VscIcon, VscTextfield, focusControl} from '../elements.js'
import {Overlay} from './overlay.js'
import type {OverlayProps} from './overlay.js'
import {activateOnKey} from './keys.js'

/** One choice in a quick pick. */
export interface QuickPickItem {
  id: string
  label: string
  /** Muted text after the label, as VS Code draws a description. */
  description?: string | undefined
  /** A second line under the label. */
  detail?: string | undefined
  icon?: string | undefined
  /** A count badge at the end, for example the number of changes. */
  count?: number | undefined
}

/**
 * The props of `QuickPick`: its items, the current one (`value`), and `onSelect`, called with the chosen item's `id`
 * after `onClose` (choosing closes it).
 */
export interface QuickPickProps extends Omit<OverlayProps, 'role' | 'children' | 'initialFocus' | 'manualFocus'> {
  items: readonly QuickPickItem[]
  /** The current item, marked and focused first. */
  value?: string | undefined
  onSelect: (id: string) => void
  label: string
  placeholder?: string
}

/** The items whose label, description or detail hold every word of the query. */
function filterItems(items: readonly QuickPickItem[], query: string): readonly QuickPickItem[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return items.filter(item =>
    terms.every(term => `${item.label} ${item.description ?? ''} ${item.detail ?? ''}`.toLowerCase().includes(term)),
  )
}

/** The option a key moves to from `index` (-1 goes back to the filter field), or undefined. */
const optionMoves = new Map<string, (index: number, length: number) => number>([
  ['ArrowDown', (index, length) => Math.min(index + 1, length - 1)],
  ['ArrowUp', index => index - 1],
  ['Home', () => 0],
  ['End', (_, length) => length - 1],
])

function QuickPickOption({
  item,
  selected,
  onChoose,
  onKeys,
}: {
  item: QuickPickItem
  selected: boolean
  onChoose: (id: string) => void
  /** The list's keys, after the option's own (Enter and Space): moving between the options and back to the field. */
  onKeys: (event: KeyboardEvent<HTMLDivElement>) => void
}) {
  const choose = () => onChoose(item.id)
  return (
    <div
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      className="phv-quick-pick-item"
      data-option={item.id}
      onClick={choose}
      onKeyDown={event => {
        activateOnKey(choose)(event)
        onKeys(event)
      }}
    >
      {item.icon && <VscIcon name={item.icon} className="phv-quick-pick-icon" aria-hidden="true" />}
      <span className="phv-quick-pick-text">
        <span className="phv-quick-pick-label">
          {item.label}
          {item.description && <span className="phv-quick-pick-description"> {item.description}</span>}
        </span>
        {item.detail && <span className="phv-quick-pick-detail">{item.detail}</span>}
      </span>
      {item.count !== undefined && (
        <VscBadge variant="counter" className="phv-count">
          {item.count.toLocaleString()}
        </VscBadge>
      )}
    </div>
  )
}

/**
 * VS Code's quick pick (`--vscode-quickInput-*`): a filter field over a list of choices with labels, descriptions and
 * details. Typing filters; Down moves into the list, arrows move in it and Enter chooses; Escape closes it.
 */
export function QuickPick({items, value, onSelect, label, placeholder, open, onClose, ...overlay}: QuickPickProps) {
  const id = useId()
  const [query, setQuery] = useState('')
  const field = useRef<HTMLElement>(null)
  const list = useRef<HTMLDivElement>(null)
  if (!open && query) setQuery('')
  const shown = useMemo(() => filterItems(items, query), [items, query])
  const options = () => [...(list.current?.querySelectorAll<HTMLElement>('[role=option]') ?? [])]
  const choose = (choice: string) => {
    onClose()
    onSelect(choice)
  }
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const all = options()
    const next = optionMoves.get(event.key)?.(all.indexOf(event.currentTarget), all.length)
    if (next === undefined) return
    event.preventDefault()
    if (next < 0) focusControl(field.current)
    else all[next]?.focus()
  }
  return (
    <Overlay {...overlay} open={open} onClose={onClose} role="dialog" label={label} initialFocus={field} className="phv-quick-pick">
      <VscTextfield
        ref={field as RefObject<never>}
        className="phv-quick-pick-input"
        type="search"
        label={label}
        aria-label={label}
        placeholder={placeholder ?? label}
        value={query}
        onInput={event => setQuery((event.target as HTMLInputElement).value)}
        onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            const all = options()
            ;(all.find(option => option.getAttribute('aria-selected') === 'true') ?? all[0])?.focus()
          } else if (event.key === 'Enter' && shown[0]) {
            event.preventDefault()
            choose(shown[0].id)
          }
        }}
      />
      <div ref={list} role="listbox" id={`${id}-list`} aria-label={label} className="phv-quick-pick-list">
        {shown.map(item => (
          <QuickPickOption key={item.id} item={item} selected={item.id === value} onChoose={choose} onKeys={move} />
        ))}
        {!shown.length && <div className="phv-quick-pick-empty">No matching results</div>}
      </div>
    </Overlay>
  )
}
