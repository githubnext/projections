import type {CSSProperties} from 'react'
import {classifyChange, isChanged} from '@githubnext/projections-renderer-kit'
import type {RendererProps} from '@githubnext/projections-renderer-kit/react'
import type {Item, Side} from './model.js'

export type Styled = CSSProperties & Record<`--${string}`, string | number>
export const emphasisStyle = (strength: number): Styled => ({'--emphasis': strength})

export interface Frame {
  props: RendererProps
  side: Side
  comparing: boolean
  strength: (item: Item) => number
}

/** The change an item inherits from the region around it, if any: it is marked once, at the region. */
export type Inherit = 'added' | 'removed' | undefined
export const inherits = (item: Item, region: Inherit) => region !== undefined && item.row.status === region
export const regionOf = (item: Item): Inherit =>
  item.row.status === 'added' || item.row.status === 'removed' ? item.row.status : undefined

/** The change a row marks in the diff: none when it inherits its region's change instead. */
export const markOf = (item: Item, frame: Frame, inherited = false) =>
  frame.side === 'diff' && isChanged(item.row) && !inherited ? classifyChange(item.row) : undefined

/**
 * Where a marked row sits in its run of neighbours marked the same way. A run is one kit change region
 * (`pk-region-run`), as text diff marks a run of changed lines: edged on its leading side throughout, and above and
 * below where it starts and ends.
 */
export interface Run {
  start: boolean
  end: boolean
}
export const runs = (marks: readonly (string | undefined)[]): Run[] =>
  marks.map((mark, index) => ({start: marks[index - 1] !== mark, end: marks[index + 1] !== mark}))
export const runAttributes = (run: Run = {start: true, end: true}) => ({
  'data-run-start': run.start ? '' : undefined,
  'data-run-end': run.end ? '' : undefined,
})

/** Whether a row's status cell shows a status: it changed, and states that itself rather than inheriting its region's mark. */
export const showsStatus = (item: Item, inherited = false) => !inherited && isChanged(item.row)

/** How strongly a column of rows shows its statuses: the strongest of the rows that show one (see `Head`). */
export const statusStrength = (items: readonly Item[], frame: Frame) =>
  Math.max(0, ...items.filter(item => showsStatus(item)).map(frame.strength))
