import type {CSSProperties} from 'react'
import type {Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {statusParts} from '@githubnext/projections-renderer-kit'
import {signed} from './timeline.js'
import type {Series} from './series.js'

type StatisticsColumns = CSSProperties &
  Record<
    '--stat-label-columns' | '--stat-value-columns' | '--stat-delta-width' | '--pk-status-width' | '--stat-was-width' | '--stat-now-width',
    string
  > & {'--emphasis'?: number}

/**
 * The view's column widths. Counts and deltas each keep a fixed column, so a delta fading in never pushes its count;
 * diff mode's value column is the struck Before count, the After count and the delta, each a fixed column.
 */
export function statisticsColumns({
  shown,
  tracked,
  labels,
  count,
  number,
  diff,
  highlighting,
}: {
  shown: readonly Series[]
  tracked: readonly EntityChange<Entity>[]
  labels: readonly string[]
  count: (value: number) => string
  number: (value: number) => string
  diff: boolean
  highlighting: number
}): StatisticsColumns {
  const labelColumns = Math.min(18, Math.max(6, ...labels.map(name => Array.from(name).length))) + 1
  const countColumns = Math.max(1, ...shown.flatMap(item => [item.before, item.after].map(amount => count(amount).length)))
  const deltaColumns = Math.max(0, ...shown.map(item => (item.before === item.after ? 0 : signed(item.after - item.before, number).length)))
  const wasColumns = Math.max(
    0,
    ...shown.map(item => (item.change === 'removed' || (item.before !== item.after && item.before !== 0) ? count(item.before).length : 0)),
  )
  const nowColumns = Math.max(0, ...shown.map(item => (item.change === 'removed' ? 0 : count(item.after).length)))
  const width = (columns: number) => (columns ? `calc(${columns}ch + var(--projections-space-2))` : '0px')
  return {
    '--stat-label-columns': `${labelColumns}ch`,
    '--stat-value-columns': diff
      ? `calc(${wasColumns + nowColumns + deltaColumns}ch + 3 * var(--projections-space-2))`
      : deltaColumns
        ? `calc(${countColumns + deltaColumns}ch + var(--projections-space-2))`
        : `${countColumns}ch`,
    '--stat-delta-width': width(deltaColumns),
    '--stat-was-width': width(wasColumns),
    '--stat-now-width': `${nowColumns}ch`,
    // The status column is as wide as the comparison's longest status, at every progress.
    '--pk-status-width': tracked.some(change => statusParts(change).length > 1) ? '20ch' : '11ch',
    ...(diff ? {'--emphasis': highlighting} : {}),
  }
}
