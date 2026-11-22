// A data table's ordering, framework-free: what each column sorts by and how a comparison's rows are ordered. The sort
// as renderer controls is `table-controls.ts`; `DataTable` (src/react/data-table.tsx) draws the table.
import type {ChangeStatus} from '@githubnext/projections-schemas'
import {isChanged} from './emphasis.js'

/** A cell's value, as a column reads it from one version of a row: what it sorts by and, by default, shows. */
export type TableValue = string | number | boolean | null | undefined

/** Which way a column sorts. */
export type SortDirection = 'ascending' | 'descending'

/** The column a table is sorted by, and which way; `null` keeps the rows' own order. */
export type TableSort = {column: string; direction: SortDirection} | null

/**
 * How a column orders its rows: `number` and `string` compare its `value` (strings naturally, so `v2` comes before
 * `v10`), a function compares two versions of rows itself, and `false` makes the column unsortable. Without it a
 * column with a `value` sorts as a string, or as a number when the values are numbers.
 */
export type ColumnSort<T> = 'number' | 'string' | ((a: T, b: T) => number) | false

/** What the table's ordering needs of a column. */
export interface SortableColumn<T> {
  /** Stable ID: letters, digits, `_`, `.` and `-`, at most 48 characters. It names the column in the sort control. */
  id: string
  /** The column's heading, in words. */
  label: string
  /** The cell's value in one version of a row: what the column sorts by, and shows unless the column renders its own. */
  value?: (item: T) => TableValue
  /** How the column orders rows (see `ColumnSort`). */
  sort?: ColumnSort<T>
  /** The direction a first click on the heading sorts in; `ascending` by default. */
  firstDirection?: SortDirection
}

/** A table row: one item across a comparison, as the kit's model pairs it (`EntityChange`), or a snapshot's item. */
export interface TableRow<T> {
  /** The row's selection ID, its `data-entity-id`. */
  id: string
  /** The item in Before; absent for an addition. */
  before?: T | undefined
  /** The item in After; absent for a removal. */
  after?: T | undefined
  /** The row's change: `unchanged` in a snapshot. */
  status: ChangeStatus
  /** True when the item kept its identity under another ID. */
  renamed?: boolean | undefined
}

/** The version of a row a table sorts and labels it by: After's, or Before's for a removed row. */
export function sortedVersion<T>(row: TableRow<T>): T {
  return (row.after ?? row.before)!
}

/** Whether a column can be sorted: it has a comparison, or a value to compare, and isn't marked unsortable. */
export function isSortable<T>(column: SortableColumn<T>): boolean {
  return column.sort !== false && (typeof column.sort === 'function' || column.value !== undefined)
}

const missing = (value: TableValue) => value === undefined || value === null || (typeof value === 'number' && Number.isNaN(value))

/** A comparison of two versions by a column, ascending, with missing values reported apart (see `sortTableRows`). */
function columnComparison<T>(column: SortableColumn<T>, rows: readonly TableRow<T>[], collator: Intl.Collator) {
  if (typeof column.sort === 'function') {
    const compare = column.sort
    return {missing: () => false, compare: (a: T, b: T) => compare(a, b)}
  }
  const value = column.value!
  const numeric =
    column.sort === 'number' ||
    (column.sort === undefined &&
      rows.some(row => typeof value(sortedVersion(row)) === 'number') &&
      rows.every(row => {
        const read = value(sortedVersion(row))
        return missing(read) || typeof read === 'number'
      }))
  const key = (item: T): TableValue => {
    const read = value(item)
    if (!numeric || missing(read)) return read
    const number = typeof read === 'number' ? read : Number(read)
    return Number.isNaN(number) ? undefined : number
  }
  return {
    missing: (item: T) => missing(key(item)),
    compare: (a: T, b: T) => {
      const [x, y] = [key(a), key(b)]
      if (numeric) return (x as number) - (y as number)
      if (typeof x === 'boolean' && typeof y === 'boolean') return Number(x) - Number(y)
      return collator.compare(String(x), String(y))
    },
  }
}

/** Options of `sortTableRows`. */
export interface SortTableOptions<T> {
  /** Changed rows first, each part in the sort's order. */
  changesFirst?: boolean | undefined
  /** BCP 47 locale for comparing strings; the runtime's by default. */
  locale?: string | undefined
  /** The row's label for breaking ties, before its ID: the first column's value by default. */
  label?: ((item: T) => string) | undefined
}

/**
 * Rows in the table's order: by `sort`'s column (`null` keeps the given order), with rows missing a value last in
 * either direction, then by label and ID, so equal rows never swap. A comparison sorts each row by After's version, or
 * Before's for a removed row, so the order is the same at every point of the transition and rows never move while it
 * plays. `changesFirst` puts changed rows (added, removed, modified, renamed) before the rest.
 */
export function sortTableRows<T, R extends TableRow<T>>(
  rows: readonly R[],
  columns: readonly SortableColumn<T>[],
  sort: TableSort,
  options: SortTableOptions<T> = {},
): R[] {
  const collator = new Intl.Collator(options.locale, {numeric: true, sensitivity: 'base'})
  const column = sort ? columns.find(item => item.id === sort.column && isSortable(item)) : undefined
  const by = column && columnComparison(column, rows, collator)
  const first = columns.find(item => item.value !== undefined)
  const label =
    options.label ??
    ((item: T) => {
      const value = first?.value?.(item)
      return missing(value) ? '' : String(value)
    })
  const sign = sort?.direction === 'descending' ? -1 : 1
  const order = new Map(rows.map((row, index) => [row.id, index]))
  return rows.toSorted((a, b) => {
    if (options.changesFirst) {
      const changed = Number(isChanged(b)) - Number(isChanged(a))
      if (changed) return changed
    }
    const [x, y] = [sortedVersion(a), sortedVersion(b)]
    if (by) {
      const [xMissing, yMissing] = [by.missing(x), by.missing(y)]
      if (xMissing !== yMissing) return xMissing ? 1 : -1
      if (!xMissing) {
        const compared = by.compare(x, y)
        if (compared) return sign * compared
      }
    } else if (!column) return order.get(a.id)! - order.get(b.id)!
    return collator.compare(label(x), label(y)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  })
}

/** The sort a heading's activation asks for: the other direction for the sorted column, else its first direction. */
export function nextSort<T>(sort: TableSort, column: SortableColumn<T>): Exclude<TableSort, null> {
  if (sort?.column === column.id) return {column: column.id, direction: sort.direction === 'ascending' ? 'descending' : 'ascending'}
  return {column: column.id, direction: column.firstDirection ?? 'ascending'}
}
