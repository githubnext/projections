// The Changes scope's folds: a run of items a list doesn't show, drawn as one row that expands in place.
import {useCallback, useState, createElement, type ElementType} from 'react'
import {ChevronsDownUp, ChevronsUpDown} from 'lucide'
import {foldList, type ChangesScope, type Folded} from '../scope.js'
import {keyed} from '@githubnext/projections-renderer-sdk/presentation'

/**
 * Folds a list for the Changes scope (`foldList`) and keeps which folds the person expanded, until the scope's shown
 * items change. Without a scope every item is listed.
 */
export function useFolds<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  scope: ChangesScope | undefined,
): {entries: Folded<T>[]; expand: (key: string) => void; collapse: (key: string) => void} {
  const shownKey = scope ? [...scope.shown].toSorted().join('\n') : ''
  const [expanded, setExpanded] = useState<{key: string; folds: ReadonlySet<string>}>({key: shownKey, folds: new Set()})
  const folds = expanded.key === shownKey ? expanded.folds : new Set<string>()
  const toggle = useCallback(
    (fold: string, open: boolean) =>
      setExpanded(previous => {
        const next = new Set(previous.key === shownKey ? previous.folds : [])
        if (open) next.add(fold)
        else next.delete(fold)
        return {key: shownKey, folds: next}
      }),
    [shownKey],
  )
  const expand = useCallback((fold: string) => toggle(fold, true), [toggle])
  const collapse = useCallback((fold: string) => toggle(fold, false), [toggle])
  return {entries: foldList(items, idOf, scope?.shown, folds), expand, collapse}
}

/**
 * A fold: "12 unchanged declarations", a button that opens the run in place; `open`, "Hide 12 unchanged declarations"
 * above the opened run, which folds it again. `as` sets its element (`div` by default, `tr` or `li` in tables and lists;
 * a `tr` puts the button in one cell spanning `columns`).
 */
export function Fold({
  count,
  noun,
  open = false,
  onToggle,
  as: Element = 'div',
  columns,
  className,
}: {
  count: number
  /** The plural noun of the folded items, for example `declarations`. */
  noun: string
  /** Whether the run is open, its items listed after the fold. */
  open?: boolean | undefined
  onToggle: () => void
  as?: ElementType
  columns?: number
  className?: string
}) {
  const label = `${open ? 'Hide ' : ''}${count.toLocaleString()} unchanged ${noun}`
  const button = (
    <button type="button" className="pk-fold-button" onClick={onToggle} aria-expanded={open} title={open ? label : `Show ${label}`}>
      <FoldGlyph open={open} />
      <span className="pk-fold-label">{label}</span>
    </button>
  )
  return (
    <Element className={`pk-fold${className ? ` ${className}` : ''}`} data-fold={open ? 'open' : 'closed'}>
      {Element === 'tr' ? <td colSpan={columns}>{button}</td> : button}
    </Element>
  )
}

/**
 * The fold's glyph: chevrons pointing apart (Lucide's `chevrons-up-down`), the run opens both ways; open, chevrons
 * pointing together (`chevrons-down-up`).
 */
function FoldGlyph({open}: {open: boolean}) {
  return (
    <svg
      className="pk-fold-icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {keyed(open ? ChevronsDownUp : ChevronsUpDown, ([tag, attributes]) => `${tag}${JSON.stringify(attributes)}`).map(
        ([key, [tag, attributes]]) => createElement(tag, {key, ...attributes}),
      )}
    </svg>
  )
}
