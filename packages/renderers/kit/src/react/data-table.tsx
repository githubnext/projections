import {useCallback, useMemo} from 'react'
import type {CSSProperties, ReactNode} from 'react'
import type {ControlValue} from '@githubnext/projections-renderer-sdk/protocol'
import {isSortable, nextSort, sortTableRows} from '../table.js'
import {tableSortOf, tableSortValue} from '../table-controls.js'
import type {SortableColumn, TableRow, TableSort} from '../table.js'
import {Row} from './data-table-row.js'
import {Fold, useFolds} from './fold.js'
import type {ChangesScope} from '../scope.js'

/** One column of a `DataTable`: its heading, what its cells show and how it sorts. */
export interface DataTableColumn<T> extends SortableColumn<T> {
  /** A cell's content for one version of a row; the formatted `value` by default. */
  render?: (item: T) => ReactNode
  /**
   * Whether the cell changed between a row's two versions: drawn as a value change (was, now) in the diff and tinted
   * in the progress modes. By default, whether `value` differs.
   */
  changed?: (before: T, after: T) => boolean
  /** `code` for identifiers and other symbols (names, paths, versions), in the monospace font; `text` (default) for words. */
  font?: 'text' | 'code'
  /** The cells' alignment: `end` for numbers (the default for a numeric `sort`), else `start`. */
  align?: 'start' | 'end'
  /** `fill` takes the width the table has to spare (the first column's default); `fit` (the others') fits the content. */
  width?: 'fill' | 'fit'
}

/** Props of `DataTable`. */
export interface DataTableProps<T> {
  /** The table's accessible name, such as what its rows are. */
  label: string
  /** The columns, in order; the first is the row's heading, frozen when the table scrolls sideways. */
  columns: readonly DataTableColumn<T>[]
  /** The rows, in their own order (kept while unsorted): the kit's model rows (`model.entities`) or rows like them. */
  rows: readonly TableRow<T>[]
  /** A comparison: a status column says each row's change in words. */
  comparing?: boolean
  /** Diff mode: both versions at once, changed values as was/now pills and added and removed rows marked. */
  diff?: boolean
  /** The frame's progress, 0 (Before) to 1 (After), outside diff mode: each row shows the version it has reached. */
  progress?: number
  /** A row's progress through its own step (a staged timeline's `local`), for rows that change at different times. */
  rowProgress?: (row: TableRow<T>) => number
  /** A row's change emphasis (`RendererProps.emphasis`): 0 at both endpoints and before its step. */
  emphasis?: (row: TableRow<T>) => number
  /** The host's selection (`RendererProps.selectedId`). */
  selectedId?: string | null
  /** Selects a row (`RendererProps.onSelect`), when its heading is activated. */
  onSelect?: (id: string) => void
  /** The sort; the rows' own order when `null` or absent. */
  sort?: TableSort
  /** Changed rows before the rest. */
  changesFirst?: boolean
  /** A heading was activated: the sort it asks for. Without it, headings don't sort. */
  onSortChange?: (sort: Exclude<TableSort, null>) => void
  /** BCP 47 locale for numbers and comparing strings (`RendererProps.locale`). */
  locale?: string
  /** Keep the first column in view when the table scrolls sideways; on by default. */
  frozen?: boolean
  /**
   * The Changes scope (`RendererProps.scope`): each run of rows it doesn't show, in the sorted order, folds into one row
   * that opens in place.
   */
  scope?: ChangesScope | undefined
  /** The rows' plural noun, for a fold's words ("12 unchanged languages"); `rows` by default. */
  noun?: string
}

/** The width each column's grid track takes. */
function track<T>(column: DataTableColumn<T>, index: number): string {
  return (column.width ?? (index === 0 ? 'fill' : 'fit')) === 'fill' ? 'minmax(max-content, 1fr)' : 'max-content'
}

/** The sort mark after a sortable heading: both ways unsorted, else the direction, in a box that never changes size. */
function SortMark({direction}: {direction: 'ascending' | 'descending' | undefined}) {
  return (
    <svg className="pk-table-sort-mark" viewBox="0 0 8 12" aria-hidden="true" data-direction={direction ?? 'none'}>
      {direction !== 'descending' && <path d="M1 5 4 2l3 3" />}
      {direction !== 'ascending' && <path d="M1 7l3 3 3-3" />}
    </svg>
  )
}

/**
 * A data table: a row per item and a column per property, the first column frozen when it scrolls sideways, every
 * heading a button that sorts by its column. In a comparison each row keeps one place for the whole transition
 * (sorted by After's version, Before's for a removed row), a status column says its change in words, and changed cells
 * are value changes: was and now pills in the diff, tinted by emphasis in the progress modes. An added or removed row
 * is marked as a whole; a row around changed cells stays neutral. Every boundary is one line, which takes the change's
 * hue when the row on either side of it is changed. Rows are selectable units (`data-entity-id`). Pass the sort and
 * `onSortChange` from `useTableProps` to keep it in the host's controls (`tableSortControls`), or leave them out for a
 * table that doesn't sort.
 */
export function DataTable<T>({
  label,
  columns,
  rows,
  comparing = false,
  diff = false,
  progress = 1,
  rowProgress,
  emphasis,
  selectedId = null,
  onSelect,
  sort = null,
  changesFirst = false,
  onSortChange,
  locale,
  frozen = true,
  scope,
  noun = 'rows',
}: DataTableProps<T>) {
  const ordered = useMemo(
    () => sortTableRows(rows, columns, sort, {changesFirst: comparing && changesFirst, locale}),
    [rows, columns, sort, comparing, changesFirst, locale],
  )
  const {entries, expand, collapse} = useFolds(ordered, row => row.id, scope)
  const template = [...columns.map(track), ...(comparing ? ['max-content'] : [])].join(' ')
  const sorted = sort && columns.some(column => column.id === sort.column && isSortable(column)) ? sort : null
  return (
    <div className="pk-table-scroll">
      <div
        role="table"
        aria-label={label}
        className="pk-table"
        data-frozen={frozen ? '' : undefined}
        style={{gridTemplateColumns: template}}
      >
        <div role="row" className="pk-table-row pk-table-head">
          {columns.map(column => {
            const direction = sorted?.column === column.id ? sorted.direction : undefined
            const align = column.align ?? (column.sort === 'number' ? 'end' : 'start')
            return (
              <div key={column.id} role="columnheader" className="pk-table-cell pk-table-heading" data-align={align} aria-sort={direction}>
                {onSortChange && isSortable(column) ? (
                  <button type="button" className="pk-table-sort" onClick={() => onSortChange(nextSort(sorted, column))}>
                    <span className="pk-table-text">{column.label}</span>
                    <SortMark direction={direction} />
                  </button>
                ) : (
                  <span className="pk-table-text">{column.label}</span>
                )}
              </div>
            )
          })}
          {comparing && (
            <div role="columnheader" className="pk-table-cell pk-table-heading pk-table-status">
              <span className="pk-table-text">Change</span>
            </div>
          )}
        </div>
        {entries.map(entry =>
          entry.type === 'fold' ? (
            <div key={`fold:${entry.key}`} role="row" className="pk-table-row pk-table-fold">
              <div role="cell" className="pk-table-fold-cell">
                <Fold
                  count={entry.items.length}
                  noun={noun}
                  open={entry.open}
                  onToggle={() => (entry.open ? collapse : expand)(entry.key)}
                />
              </div>
            </div>
          ) : (
            <Row
              key={entry.item.id}
              row={entry.item}
              columns={columns}
              comparing={comparing}
              diff={diff}
              progress={rowProgress ? rowProgress(entry.item) : progress}
              emphasis={emphasis ? emphasis(entry.item) : 0}
              selected={selectedId === entry.item.id}
              onSelect={onSelect}
              locale={locale}
            />
          ),
        )}
      </div>
    </div>
  )
}

/** What `useTableProps` reads from a kit renderer's props. */
export interface TablePropsSource {
  comparing: boolean
  diff: boolean
  progress: number
  emphasis: (row: TableRow<unknown> & {id?: string}) => number
  selectedId: string | null
  onSelect: (id: string | null) => void
  locale: string
  controls: {[id: string]: ControlValue}
  setControl: (id: string, value: ControlValue) => void
  scope?: ChangesScope | undefined
}

/**
 * A `DataTable`'s props from a kit renderer's (`RendererProps`): the comparison, mode, progress, emphasis, selection,
 * locale and Changes scope, and the sort held in the controls `tableSortControls` declares under `id` (`sort` by default), which a
 * heading's activation sets through the host, so the host remembers it, shows it in its settings and lets agents read
 * and set it. Spread them: `<DataTable {...useTableProps(props)} label columns rows />`.
 */
export function useTableProps(props: TablePropsSource, id = 'sort') {
  const {sort, changesFirst} = tableSortOf(props.controls, id)
  const {setControl, emphasis, onSelect} = props
  const onSortChange = useCallback((next: Exclude<TableSort, null>) => setControl(id, tableSortValue(next)), [setControl, id])
  return {
    comparing: props.comparing,
    diff: props.diff,
    progress: props.progress,
    emphasis: emphasis as (row: TableRow<unknown>) => number,
    selectedId: props.selectedId,
    onSelect: onSelect as (id: string) => void,
    locale: props.locale,
    sort,
    changesFirst,
    onSortChange,
    scope: props.scope,
  }
}
