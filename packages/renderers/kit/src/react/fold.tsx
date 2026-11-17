// The Changes scope's folds: a run of items a list doesn't show, drawn as one row that expands in place.
import {useCallback, useState} from 'react'
import {createElement} from 'react'
import type {ElementType} from 'react'
import {ChevronsUpDown} from 'lucide'
import {foldList} from '../scope.js'
import type {ChangesScope, Folded} from '../scope.js'

/**
 * Folds a list for the Changes scope (`foldList`) and keeps which folds the person expanded, until the scope's shown
 * items change. Without a scope every item is listed.
 */
export function useFolds<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  scope: ChangesScope | undefined,
): {entries: Folded<T>[]; expand: (key: string) => void} {
  const shownKey = scope ? [...scope.shown].sort().join('\n') : ''
  const [expanded, setExpanded] = useState<{key: string; folds: ReadonlySet<string>}>({key: shownKey, folds: new Set()})
  const folds = expanded.key === shownKey ? expanded.folds : new Set<string>()
  const expand = useCallback(
    (fold: string) =>
      setExpanded(previous => ({key: shownKey, folds: new Set([...(previous.key === shownKey ? previous.folds : []), fold])})),
    [shownKey],
  )
  return {entries: foldList(items, idOf, scope?.shown, folds), expand}
}

/**
 * A fold: "12 unchanged declarations", a button that expands the run in place. `as` sets its element (`div` by
 * default, `tr` or `li` in tables and lists; a `tr` puts the button in one cell spanning `columns`).
 */
export function Fold({
  count,
  noun,
  onExpand,
  as: Element = 'div',
  columns,
  className,
}: {
  count: number
  /** The plural noun of the folded items, for example `declarations`. */
  noun: string
  onExpand: () => void
  as?: ElementType
  columns?: number
  className?: string
}) {
  const label = `${count.toLocaleString()} unchanged ${noun}`
  const button = (
    <button type="button" className="pk-fold-button" onClick={onExpand} aria-label={`Show ${label}`} title={`Show ${label}`}>
      <FoldGlyph />
      <span className="pk-fold-label">{label}</span>
    </button>
  )
  return (
    <Element className={`pk-fold${className ? ` ${className}` : ''}`} data-fold="">
      {Element === 'tr' ? <td colSpan={columns}>{button}</td> : button}
    </Element>
  )
}

/** The fold's glyph, chevrons pointing up and down (Lucide's `chevrons-up-down`): the run opens both ways. */
function FoldGlyph() {
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
      {ChevronsUpDown.map(([tag, attributes], index) => createElement(tag, {key: index, ...attributes}))}
    </svg>
  )
}
