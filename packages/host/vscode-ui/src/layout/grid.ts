import type {CSSProperties} from 'react'
import type {ToolbarLayout} from './steps.js'

/** The regions a toolbar grid holds, in order. */
export interface ToolbarRegions {
  start?: boolean
  mode?: boolean
  playback?: boolean
}

/**
 * A centred mode region's grid: the picker and the actions get equal halves of what the mode region leaves, so it sits
 * at the row's centre, the picker at the row's start and the actions at its end; playback has row 2 to itself.
 */
function centredGrid(layout: Pick<ToolbarLayout, 'rows'>, regions: ToolbarRegions): CSSProperties {
  const row = ['start', 'mode', 'end']
  const areas = [row, ...(regions.playback && layout.rows === 2 ? [row.map(() => 'playback')] : [])]
  return {
    gridTemplateColumns: 'minmax(0, 1fr) max-content minmax(0, 1fr)',
    gridTemplateAreas: areas.map(line => `"${line.join(' ')}"`).join(' '),
  }
}

/**
 * The grid for a `ToolbarLayout` (`centredGrid` for a centred mode region): start (the picker), mode, playback and end (the actions) share one row with the
 * slider taking what is left, or, with two rows, row 1 holds start, mode and end and row 2 the playback group.
 * Regions a toolbar lacks take no column.
 */
export function toolbarGrid(layout: Pick<ToolbarLayout, 'rows' | 'cluster'>, regions: ToolbarRegions): CSSProperties {
  if (layout.cluster === 'centre') return centredGrid(layout, regions)
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
