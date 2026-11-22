import {useMemo} from 'react'
import {DataTable, useTableProps, type DataTableColumn, type RendererProps} from '@githubnext/projections-renderer-kit/react'
import {tableSortControls} from '@githubnext/projections-renderer-kit'
import type {RendererControl} from '@githubnext/projections-renderer-sdk/protocol'
import {
  sentenceCase,
  statisticsCount,
  type CodeStatisticsScope,
  type StatisticsKey,
} from '@githubnext/projections-renderer-sdk/presentation'
import type {Entity} from '@githubnext/projections-schemas'
import type {accepts} from './accepts.js'

const name = (entity: Entity) => entity.label ?? entity.id

/** A count column: numbers, sorted largest first on a first click. */
function count(id: StatisticsKey, label: string, scope: CodeStatisticsScope): DataTableColumn<Entity> {
  return {id, label, value: entity => statisticsCount(entity, id, scope), sort: 'number', firstDirection: 'descending'}
}

/**
 * The table's columns: a language's name and every count (files, then its code, comment and blank lines and their
 * sum), or for generic measurements each one's name, value and unit.
 */
export function statisticsTableColumns(metrics: boolean, rows: string, scope: CodeStatisticsScope): DataTableColumn<Entity>[] {
  const first: DataTableColumn<Entity> = {id: 'name', label: sentenceCase(rows), value: name}
  // A measurement's unit is part of its meaning, and a unit that changes is a change of its own.
  const unit: DataTableColumn<Entity> = {
    id: 'unit',
    label: 'Unit',
    value: entity => (typeof entity.data?.unit === 'string' ? entity.data.unit : undefined),
  }
  if (metrics) return [first, count('value', 'Value', 'all'), unit]
  return [
    first,
    count('files', 'Files', scope),
    count('code', 'Code', scope),
    count('comment', 'Comments', scope),
    count('blank', 'Blank', scope),
    count('lines', 'All lines', scope),
  ]
}

/** The table's sort controls: by the measure the table opens sorted by, largest first. */
export function statisticsTableControls(metrics: boolean): RendererControl[] {
  return tableSortControls({
    columns: statisticsTableColumns(metrics, 'item', 'all'),
    default: {column: metrics ? 'value' : 'code', direction: 'descending'},
  })
}

/**
 * The table chart: a row per language (or measurement) and a column per count, sorted by any of them from its heading
 * or the host's settings, every language of either revision in one place for the whole transition.
 */
export function StatisticsTable({
  props,
  metrics,
  rows,
  scope,
  rowProgress,
}: {
  props: RendererProps<typeof accepts>
  metrics: boolean
  rows: string
  scope: CodeStatisticsScope
  rowProgress: (id: string) => number
}) {
  const table = useTableProps(props)
  const columns = useMemo(() => statisticsTableColumns(metrics, rows, scope), [metrics, rows, scope])
  return (
    <DataTable
      {...table}
      diff={props.diff && props.comparing}
      label={metrics ? sentenceCase(rows) : 'Languages'}
      noun={metrics ? 'measurements' : 'languages'}
      columns={columns}
      rows={props.model.entities}
      rowProgress={row => rowProgress(row.id)}
    />
  )
}
