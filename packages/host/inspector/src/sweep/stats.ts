import type {Sweep, SweepCell, SweepChange, SweepProjection} from '../types.js'
import {plural} from '../plural.js'

/** How a change reads: its pull request number, else its short commit. */
export function changeLabel(change: Pick<SweepChange, 'number' | 'after'>): string {
  return change.number === null ? change.after.slice(0, 8) : `#${change.number}`
}

/** A cell's summary in words: "3 changes, 2 steps". */
export function cellSummary(cell: Pick<SweepCell, 'status' | 'changes' | 'steps'>): string {
  if (cell.status === 'failed') return 'Failed'
  if (cell.status === 'unchanged') return 'No change'
  return `${plural(cell.changes ?? 0, 'change')}, ${plural(cell.steps ?? 0, 'step')}`
}

/** Where a cell opens: the Inspector on that pair, with the working tree's projection code. */
export function cellHref(cell: Pick<SweepCell, 'projection' | 'before' | 'after'>): string {
  return `?${new URLSearchParams({view: 'inspect', projection: cell.projection, before: cell.before, after: cell.after})}`
}

/** How often a projection changed across a sweep, and what that suggests. */
export interface ColumnStats {
  /** Changes swept for it so far. */
  swept: number
  changed: number
  failed: number
  /** The median change count among the changes it showed something on. */
  median: number
  /** `noisy`: changes on nearly every change; `rare`: only on a few, structural ones; `quiet`: never. */
  signal: 'noisy' | 'rare' | 'steady' | 'quiet' | 'unknown'
}

/** Below this many swept changes, a projection's signal isn't judged. */
const JUDGED_FROM = 4

export function columnStats(projection: string, cells: readonly SweepCell[]): ColumnStats {
  const mine = cells.filter(cell => cell.projection === projection)
  const changed = mine.filter(cell => cell.status === 'changed')
  const counts = changed.map(cell => cell.changes ?? 0).toSorted((a, b) => a - b)
  const middle = Math.floor(counts.length / 2)
  const median = counts.length === 0 ? 0 : counts.length % 2 ? counts[middle]! : (counts[middle - 1]! + counts[middle]!) / 2
  const judged = mine.filter(cell => cell.status !== 'failed').length
  const ratio = judged ? changed.length / judged : 0
  const signal =
    judged < JUDGED_FROM ? 'unknown' : changed.length === 0 ? 'quiet' : ratio >= 0.8 ? 'noisy' : ratio <= 0.25 ? 'rare' : 'steady'
  return {swept: mine.length, changed: changed.length, failed: mine.length - judged, median, signal}
}

/** A column's summary and hint, in words. */
export function statsText(stats: ColumnStats): {summary: string; hint?: string} {
  const summary = `Changed in ${stats.changed} of ${plural(stats.swept, 'change')}${
    stats.changed ? ` · median ${plural(stats.median, 'change')}` : ''
  }${stats.failed ? ` · failed on ${stats.failed}` : ''}`
  const hint = {
    noisy: 'Changes on nearly every change; may be noisy',
    rare: 'Rarely changes; shows up for structural work',
    quiet: "Didn't change here; may not suit this repository",
    steady: undefined,
    unknown: undefined,
  }[stats.signal]
  return hint ? {summary, hint} : {summary}
}

const SIGNAL_RANK: Record<ColumnStats['signal'], number> = {rare: 0, steady: 1, unknown: 2, noisy: 3, quiet: 4}

/** Projections in signal order: structural ones first, then steady, noisy and quiet ones; skipped ones last. */
export function bySignal(rows: readonly SweepProjection[], cells: readonly SweepCell[]): SweepProjection[] {
  const rank = (row: SweepProjection) => (row.status === 'ready' ? SIGNAL_RANK[columnStats(row.projection, cells).signal] : 5)
  return rows.toSorted(
    (a, b) =>
      rank(a) - rank(b) ||
      columnStats(b.projection, cells).changed - columnStats(a.projection, cells).changed ||
      a.projection.localeCompare(b.projection),
  )
}

/**
 * The projections, other than noisy ones, that changed on each change: two or more make a change a good one to
 * show when deciding what to adopt.
 */
export function signalCounts(sweep: Pick<Sweep, 'cells' | 'projections'>): Map<string, number> {
  const noisy = new Set(
    sweep.projections.filter(row => columnStats(row.projection, sweep.cells).signal === 'noisy').map(row => row.projection),
  )
  const counts = new Map<string, number>()
  for (const cell of sweep.cells) {
    if (cell.status === 'changed' && !noisy.has(cell.projection)) counts.set(cell.after, (counts.get(cell.after) ?? 0) + 1)
  }
  return counts
}
