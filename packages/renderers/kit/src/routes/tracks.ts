// Separate tracks for S routes whose crossing runs share a gap.
import type {Point} from '../edge-arrows.js'
import {sTurn} from './s-bend.js'
import {frame} from './vector.js'

/** Space between the crossing runs of S routes that share a gap and would otherwise lie on one another. */
export const trackSpacing = 10

/** One S for `routeTracks`: the arguments it will be drawn with (see `sBend`). */
export interface TrackRun {
  /** Where the S starts. */
  start: Point
  /** Where the S ends: the arrowhead's tip when `lead` is set. */
  end: Point
  /** The unit direction the S leaves and arrives along (see `sBend`); only runs along the same axis share tracks. */
  axis: Point
  /** Whether the S ends with the arrowhead's lead-in (`RouteOptions.lead`); default true. */
  lead?: boolean
  /** Where along `axis` the S may turn, as distances from `start` (`RouteOptions.band`). */
  band?: readonly [number, number]
}

/**
 * Tracks (`RouteOptions.track`) for S routes drawn together, so no two
 * crossing runs lie on one another: runs in one gap whose spans across the
 * axis overlap are spread `trackSpacing` apart about their common middle,
 * ordered so they cross as little as possible (of two routes heading the same
 * way, the one leaving later turns first, clear of the other's first leg).
 * Routes leaving one point the same way share their first stretch, as a
 * trunk. Returns 0 for a run that shares its place with none.
 */
export function routeTracks(runs: readonly TrackRun[], spacing = trackSpacing): number[] {
  const info = runs.map(run => {
    const turn = sTurn(run.start, run.end, run.axis, run)
    if (!turn || Math.abs(turn.across) < 2) return undefined
    const f = frame(run.axis)
    return {
      along: f.along(run.start) + turn.middle,
      middle: f.along(run.start) + (turn.band[0] + turn.band[1]) / 2,
      low: Math.min(f.across(run.start), f.across(run.end)),
      high: Math.max(f.across(run.start), f.across(run.end)),
      sign: Math.sign(turn.across),
      leaving: f.across(run.start),
      axis: `${run.axis.x},${run.axis.y}`,
    }
  })
  const tracks = runs.map(() => 0)
  const parent = runs.map((_, index) => index)
  const root = (index: number): number => (parent[index] === index ? index : (parent[index] = root(parent[index]!)))
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const p = info[i],
        q = info[j]
      if (!p || !q || p.axis !== q.axis) continue
      const a = runs[i]!,
        b = runs[j]!
      // Routes leaving one port the same way are one trunk: always together, on one track.
      if (p.sign === q.sign && Math.hypot(a.start.x - b.start.x, a.start.y - b.start.y) < 0.5) {
        parent[root(i)] = root(j)
        continue
      }
      if (Math.abs(p.along - q.along) < spacing && Math.min(p.high, q.high) - Math.max(p.low, q.low) > 2) parent[root(i)] = root(j)
    }
  }
  const groups = new Map<number, number[]>()
  runs.forEach((_, index) => {
    if (info[index]) groups.set(root(index), [...(groups.get(root(index)) ?? []), index])
  })
  for (const group of groups.values()) {
    // Runs leaving one point the same way are one bundle on one track: a trunk.
    const bundles = new Map<string, number[]>()
    for (const index of group) {
      const run = runs[index]!
      const id = `${run.start.x.toFixed(1)},${run.start.y.toFixed(1)},${info[index]!.sign}`
      bundles.set(id, [...(bundles.get(id) ?? []), index])
    }
    // A lone trunk still lines its members up on one run.
    if (bundles.size < 2 && group.length < 2) continue
    const key = (bundle: number[]) => {
      const run = info[bundle[0]!]!
      return [run.sign > 0 ? 0 : 1, run.sign > 0 ? -run.leaving : run.leaving] as const
    }
    const order = [...bundles.values()].sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1] || a[0]! - b[0]!)
    const centre = group.reduce((sum, index) => sum + info[index]!.along, 0) / group.length
    order.forEach((bundle, position) => {
      for (const index of bundle) tracks[index] = centre + (position - (order.length - 1) / 2) * spacing - info[index]!.middle
    })
  }
  return tracks
}
