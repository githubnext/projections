// A data table's sort as renderer controls, which the host draws in its settings menu and remembers, and which
// agents read and set; a heading's activation sets them too (`useTableProps`).
import {defineControls} from '@githubnext/projections-renderer-sdk/protocol'
import type {ControlValue, RendererControl} from '@githubnext/projections-renderer-sdk/protocol'
import {isSortable} from './table.js'
import type {SortableColumn, TableSort} from './table.js'

const columnIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,47}$/

/** The sort control's value for a sort: `<column>:ascending`, `<column>:descending`, or `none`. */
export function tableSortValue(sort: TableSort): string {
  return sort ? `${sort.column}:${sort.direction}` : 'none'
}

/** The sort a sort control's value names; `null` for `none` or anything else. */
export function parseTableSort(value: ControlValue | undefined): TableSort {
  if (typeof value !== 'string') return null
  const at = value.lastIndexOf(':')
  const direction = value.slice(at + 1)
  if (at < 1 || (direction !== 'ascending' && direction !== 'descending')) return null
  return {column: value.slice(0, at), direction}
}

/** Options of `tableSortControls`. */
export interface TableSortControlsOptions<T> {
  /** The table's columns; each sortable one is offered both ways (24 at most). */
  columns: readonly SortableColumn<T>[]
  /** The sort control's ID, `sort` by default; the changes-first toggle's is `<id>ChangesFirst`. */
  id?: string
  /** The sort the table opens with; `null` (the default) keeps the rows' own order. */
  default?: TableSort
  /** Offer the "Changes first" toggle, on by default; `false` leaves it out. */
  changesFirst?: boolean
  /** The changes-first toggle's default; off unless set. */
  changesFirstDefault?: boolean
  /** The controls' group and its label in the host's settings menu: `sort` and "Sort" by default. */
  group?: {id: string; label: string}
}

const shorten = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/**
 * A table's sort as renderer controls, which the host draws in its settings menu, remembers and lets agents read and
 * set: a choice of each sortable column in either direction (or the rows' own order), and a "Changes first" toggle.
 * Declare them (`MountOptions.controls`, or `declareControls`) and read them with `tableSortOf`; `DataTable` sets the
 * choice when a heading is activated (see `useTableProps`).
 */
export function tableSortControls<T>(options: TableSortControlsOptions<T>): RendererControl[] {
  const id = options.id ?? 'sort'
  const group = options.group ?? {id: 'sort', label: 'Sort'}
  const sortable = options.columns.filter(isSortable).slice(0, 24)
  for (const column of sortable)
    if (!columnIdPattern.test(column.id)) throw new Error(`Column ID "${column.id}" can't name a sort: use letters, digits, _ . -`)
  const fallback = tableSortValue(options.default ?? null)
  const choices = [
    {value: 'none', label: 'Original order'},
    ...sortable.flatMap(column => [
      {value: tableSortValue({column: column.id, direction: 'ascending'}), label: shorten(`${column.label}, ascending`, 80)},
      {value: tableSortValue({column: column.id, direction: 'descending'}), label: shorten(`${column.label}, descending`, 80)},
    ]),
  ]
  return defineControls([
    {
      id,
      label: 'Sort by',
      description: 'The column the table is sorted by, and which way; activating a column heading sets it too',
      type: 'choice',
      group: group.id,
      groupLabel: group.label,
      default: choices.some(choice => choice.value === fallback) ? fallback : 'none',
      choices,
    },
    ...(options.changesFirst === false
      ? []
      : [
          {
            id: `${id}ChangesFirst`,
            label: 'Changes first',
            description: "In a comparison, the changed rows before the rest, each in the sort's order",
            type: 'toggle' as const,
            group: group.id,
            default: options.changesFirstDefault ?? false,
          },
        ]),
  ])
}

/** A table's sort from control values (`RendererProps.controls`), for the controls `tableSortControls` declares. */
export function tableSortOf(values: {readonly [id: string]: ControlValue}, id = 'sort'): {sort: TableSort; changesFirst: boolean} {
  return {sort: parseTableSort(values[id]), changesFirst: values[`${id}ChangesFirst`] === true}
}
