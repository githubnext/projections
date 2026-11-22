// Separating parallel runs: routes leaving one port turn together, and runs sharing a gap take separate tracks.
import {trackSpacing} from '../../routes/tracks.js'
import type {RoutingContext, Segment} from './context.js'
import {moveRun, turnOf} from './runs.js'
import type {Run} from './runs.js'
import {separateBundles} from './bundles.js'
import {moveTrunksOff} from './trunk-moves.js'

/**
 * Crossing runs that would lie on one another in a shared gap take separate tracks, in the order that crosses
 * least; runs already moved (a track, or a turn early or late) are taken where they are now.
 */
export function separateRuns(ctx: RoutingContext): void {
  const {along, across} = ctx
  const all = ctx.all()
  alignTrunks(ctx, all)
  // Crossing runs that would lie on one another in a shared gap take separate tracks, in the order that crosses least.
  const runs = new Map<Segment, Run>()
  for (const segment of all) {
    if (!segment.band) continue
    const turn = turnOf(ctx, segment)
    if (!turn || Math.abs(turn.across) < 2) continue
    runs.set(segment, {
      along: along(segment.start) + turn.middle,
      low: Math.min(across(segment.start), across(segment.end!)),
      high: Math.max(across(segment.start), across(segment.end!)),
      sign: Math.sign(turn.across),
      middle: along(segment.start) + (segment.band[0] + segment.band[1]) / 2,
    })
  }
  for (const group of overlappingClusters(runs)) separateBundles(ctx, all, runs, group)
  moveTrunksOff(ctx, all, runs)
}

/** Routes leaving one port the same way turn together, as one trunk: at the earliest of their runs. */
function alignTrunks(ctx: RoutingContext, all: readonly Segment[]): void {
  const trunks = new Map<string, Segment[]>()
  for (const segment of all) {
    if (!segment.band) continue
    const turn = turnOf(ctx, segment)
    if (!turn || Math.abs(turn.across) < 2) continue
    const id = `${segment.start.x.toFixed(1)},${segment.start.y.toFixed(1)},${Math.sign(turn.across)}`
    trunks.set(id, [...(trunks.get(id) ?? []), segment])
  }
  for (const trunk of trunks.values()) {
    if (trunk.length < 2) continue
    const middleOf = (segment: Segment) => turnOf(ctx, segment)!.middle
    const earliest = Math.min(...trunk.map(middleOf))
    for (const segment of trunk) {
      if (Math.abs(middleOf(segment) - earliest) > 0.01 && Math.abs(middleOf(segment) - earliest) < trackSpacing) {
        moveRun(ctx, segment, ctx.along(segment.start) + earliest)
      }
    }
  }
}

/** Groups of runs that lie on one another (transitively), each group with at least one run. */
function overlappingClusters(runs: ReadonlyMap<Segment, Run>): Segment[][] {
  const overlapping = (a: Segment, b: Segment) => {
    const p = runs.get(a)!,
      q = runs.get(b)!
    // Routes leaving one port the same way share their first stretch: a trunk (lined up separately), not an overlap.
    if (p.sign === q.sign && Math.hypot(a.start.x - b.start.x, a.start.y - b.start.y) < 0.5) return false
    return Math.abs(p.along - q.along) < trackSpacing && Math.min(p.high, q.high) - Math.max(p.low, q.low) > 2
  }
  const members = [...runs.keys()]
  const cluster = new Map(members.map(segment => [segment, segment]))
  const root = (segment: Segment): Segment => (cluster.get(segment) === segment ? segment : root(cluster.get(segment)!))
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      if (overlapping(members[i]!, members[j]!)) cluster.set(root(members[i]!), root(members[j]!))
    }
  }
  const clusters = new Map<Segment, Segment[]>()
  for (const segment of members) clusters.set(root(segment), [...(clusters.get(root(segment)) ?? []), segment])
  return [...clusters.values()]
}
