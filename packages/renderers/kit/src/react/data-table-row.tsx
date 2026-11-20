// One row of a `DataTable`: a selectable unit, its cells in the version the frame shows (both in the diff), its
// changed cells as value changes and, in a comparison, its change in words.
import type {CSSProperties, ReactNode} from 'react'
import {identifier as identifierAttributes} from '@githubnext/projections-renderer-sdk/presentation'
import {changeMark} from '../diff/model.js'
import {isChanged} from '../emphasis.js'
import {sortedVersion} from '../table.js'
import type {TableRow, TableValue} from '../table.js'
import {ChangeStatus} from './components.js'
import {ValueChange} from './diff-components.js'
import type {DataTableColumn} from './data-table.js'

const join = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ')

const shown = (value: ReactNode) => value !== undefined && value !== null && value !== false

/** A cell value in words: numbers in the locale; a missing value stays missing, so a value change shows only the other side. */
function formatted(value: TableValue, locale: string | undefined): string | undefined {
  if (value === undefined || value === null || (typeof value === 'number' && Number.isNaN(value))) return undefined
  if (typeof value === 'number') return value.toLocaleString(locale)
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return value
}

export function Row<T>({
  row,
  columns,
  comparing,
  diff,
  progress,
  emphasis,
  selected,
  onSelect,
  locale,
}: {
  row: TableRow<T>
  columns: readonly DataTableColumn<T>[]
  comparing: boolean
  diff: boolean
  progress: number
  emphasis: number
  selected: boolean
  onSelect: ((id: string) => void) | undefined
  locale: string | undefined
}) {
  const changed = isChanged(row)
  // The diff marks every change, its hue following emphasis; the progress modes mark one only while it is emphasized.
  const marked = changed && (diff || emphasis > 0)
  const side = row.before && row.after ? (progress < 0.5 ? 'before' : 'after') : row.after ? 'after' : 'before'
  const item = diff ? sortedVersion(row) : (row[side] ?? sortedVersion(row))
  // An entering or leaving row keeps its slot, fading in or out with its step.
  const presence = diff || (row.before && row.after) ? 1 : row.after ? progress : 1 - progress
  const struck = marked && row.status === 'removed'
  const style = {'--emphasis': emphasis, ...(presence < 1 ? {opacity: Math.max(0, presence)} : {})}
  // A row absent from the revision shown keeps its slot but is out of the tab order and the accessibility tree.
  const absent = presence <= 0.01
  return (
    <div
      role="row"
      className={join('pk-table-row', marked && 'pk-region', selected && 'selected')}
      data-entity-id={row.id}
      data-projections-unit=""
      {...(marked ? changeMark(row) : {})}
      {...(absent ? {inert: true, 'aria-hidden': true} : {})}
      style={style as CSSProperties}
    >
      {columns.map((column, index) => {
        const read = (version: T) => {
          const content = column.render ? column.render(version) : formatted(column.value?.(version), locale)
          return column.font === 'code' && shown(content) ? (
            <span className="pk-table-code" {...identifierAttributes}>
              {content}
            </span>
          ) : (
            content
          )
        }
        // Only a changed row's cells are changes: an unchanged one may still differ within a volatile value's tolerance.
        const differs =
          changed &&
          row.before !== undefined &&
          row.after !== undefined &&
          (column.changed
            ? column.changed(row.before, row.after)
            : column.value !== undefined && !Object.is(column.value(row.before), column.value(row.after)))
        let content: ReactNode
        if (differs && diff) content = <ValueChange layout="inline" before={read(row.before!)} after={read(row.after!)} />
        else if (differs && emphasis > 0)
          // The version shown, as a pill in its side's hue while the change is emphasized; at the endpoints, plain text
          // exactly as an unchanged cell draws it.
          content = (
            <span className="pk-change-pill pk-table-value" data-change={side === 'before' ? 'removed' : 'added'}>
              <span className="sr-only">{side === 'before' ? 'was ' : 'now '}</span>
              {read(item)}
            </span>
          )
        else content = <span className={join('pk-table-text', struck && 'pk-diff-text')}>{read(item)}</span>
        // Outside the diff a changed cell shows one version at a time; the other is laid out under it, unseen, so the
        // column keeps one width for the whole transition and nothing moves when the value switches.
        if (differs && !diff)
          content = (
            <span className="pk-table-reserve">
              {content}
              <span className="pk-table-reserve-other" aria-hidden="true">
                {read(side === 'before' ? row.after! : row.before!)}
              </span>
            </span>
          )
        const align = column.align ?? (column.sort === 'number' ? 'end' : 'start')
        return (
          <div
            key={column.id}
            role={index === 0 ? 'rowheader' : 'cell'}
            className={join('pk-table-cell', index === 0 && 'pk-table-first')}
            data-align={align}
          >
            {index === 0 && onSelect ? (
              <button type="button" className="pk-table-select" aria-pressed={selected} onClick={() => onSelect(row.id)}>
                {content}
              </button>
            ) : (
              content
            )}
          </div>
        )
      })}
      {comparing && (
        <div role="cell" className="pk-table-cell pk-table-status">
          <ChangeStatus change={row} emphasis={emphasis} />
        </div>
      )}
    </div>
  )
}
