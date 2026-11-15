import type {CSSProperties} from 'react'
import type {ToolbarLayout} from './steps.js'

/** The regions a toolbar grid holds, in order. */
export interface ToolbarRegions {
  start?: boolean
  mode?: boolean
  playback?: boolean
}

/**
 * The grid for a `ToolbarLayout`: start (the picker), mode, playback and end (the actions) share one row with the
 * slider taking what is left, or, with two rows, row 1 holds start, mode and end and row 2 the playback group.
 * Regions a toolbar lacks take no column.
 */
export function toolbarGrid(layout: Pick<ToolbarLayout, 'rows'>, regions: ToolbarRegions): CSSProperties {
  const first = [...(regions.start ? ['start'] : []), ...(regions.mode ? ['mode'] : [])]
  const playbackInRow = regions.playback && layout.rows === 1
  const columns = [
    ...first.map(() => 'max-content'),
    ...(playbackInRow ? ['minmax(min-content, 1fr)', 'max-content'] : ['minmax(max-content, 1fr)']),
  ]
  const row = [...first, ...(playbackInRow ? ['playback'] : []), 'end']
  const areas = [row, ...(regions.playback && layout.rows === 2 ? [row.map(() => 'playback')] : [])]
  return {
    gridTemplateColumns: columns.join(' '),
    gridTemplateAreas: areas.map(line => `"${line.join(' ')}"`).join(' '),
  }
}
