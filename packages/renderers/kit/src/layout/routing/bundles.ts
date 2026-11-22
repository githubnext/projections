// Runs lying on one another in a shared gap: each bundle (routes leaving one port the same way) on its own track.
import {polylineCrossings} from '../../routes/crossings.js'
import {routeRadius} from '../../routes/s-bend.js'
import {trackSpacing} from '../../routes/tracks.js'
import {sampleSpline} from '../../splines.js'
import {compareIds} from '../model.js'
import type {RoutingContext, Segment} from './context.js'
import {build} from './build.js'
import {restoreRun, type Run} from './runs.js'

/**
 * Puts each bundle of a group of overlapping runs on its own track, `trackSpacing` apart, in the order that crosses
 * least; records how much wider the gap must grow (`crowding`) when the tracks don't fit.
 */
export function separateBundles(ctx: RoutingContext, all: readonly Segment[], runs: ReadonlyMap<Segment, Run>, group: Segment[]): void {
  const {along, across} = ctx
  // Routes leaving one port the same way are one bundle: a trunk on one track, parting as each turns to its target.
  const bundles = new Map<string, Segment[]>()
  for (const segment of group) {
    const id = `${segment.start.x.toFixed(1)},${segment.start.y.toFixed(1)},${runs.get(segment)!.sign}`
    bundles.set(id, [...(bundles.get(id) ?? []), segment])
  }
  if (bundles.size < 2) return
  // Where every member's run keeps full turns, and the room its tracks need side by side; the gap grows if short.
  const lowest = Math.max(...group.map(segment => along(segment.start) + segment.band![0] + routeRadius))
  const highest = Math.min(...group.map(segment => along(segment.start) + segment.band![1] - routeRadius))
  const need = (bundles.size - 1) * trackSpacing
  ctx.crowding = Math.max(ctx.crowding, need - (highest - lowest))
  // A bundle heading one way crosses the other's first leg unless the later-leaving one turns first.
  const key = (bundle: Segment[]) => {
    const run = runs.get(bundle[0]!)!
    return [run.sign > 0 ? 0 : 1, run.sign > 0 ? -across(bundle[0]!.start) : across(bundle[0]!.start)] as const
  }
  const order = [...bundles.values()].toSorted((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1] || compareIds(a[0]!.key, b[0]!.key))
  const mean = group.reduce((sum, segment) => sum + runs.get(segment)!.along, 0) / group.length
  const centre = highest - lowest >= need ? Math.max(lowest + need / 2, Math.min(highest - need / 2, mean)) : (lowest + highest) / 2
  const place = () => {
    for (const [index, bundle] of order.entries()) {
      for (const segment of bundle) {
        segment.run = centre + (index - (order.length - 1) / 2) * trackSpacing - along(segment.start)
        build(ctx, segment)
      }
    }
  }
  const related = relatedCrossings(ctx, all, group)
  const saved = new Map(group.map(segment => [segment, segment.run]))
  const relatedBefore = related()
  place()
  let best = bundleCrossings(order)
  // Neighbouring swaps until none helps; a very large bundle of runs keeps the rule's order.
  for (let round = 0; round < Math.min(order.length, 4) && best > 0 && order.length <= 16; round++) {
    let improved = false
    for (let index = 0; index + 1 < order.length; index++) {
      ;[order[index], order[index + 1]] = [order[index + 1]!, order[index]!]
      place()
      const count = bundleCrossings(order)
      if (count < best) {
        best = count
        improved = true
      } else {
        ;[order[index], order[index + 1]] = [order[index + 1]!, order[index]!]
        place()
      }
    }
    if (!improved) break
  }
  if (related() > relatedBefore) for (const [segment, run] of saved) restoreRun(ctx, segment, run)
}

/** Distinct places where the bundles' routes cross: a trunk crossing a bundle's run is one crossing, not one per route pair. */
function bundleCrossings(order: readonly Segment[][]): number {
  const sampled = new Map(
    order.flat().map(segment => {
      const points = sampleSpline(segment.route!, 8)
      const xs = points.map(point => point.x),
        ys = points.map(point => point.y)
      return [segment, {points, box: [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)] as const}] as const
    }),
  )
  const places = new Set<string>()
  // Routes into one card or out of one must never cross: any such crossing outweighs every other.
  let converging = 0
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      for (const a of order[i]!) {
        for (const b of order[j]!) {
          const p = sampled.get(a)!,
            q = sampled.get(b)!
          if (p.box[1] < q.box[0] || q.box[1] < p.box[0] || p.box[3] < q.box[2] || q.box[3] < p.box[2]) continue
          const shared = [...(a.from === b.from ? [a.start] : []), ...(a.to === b.to ? [a.end!, b.end!] : [])]
          const found = polylineCrossings(p.points, q.points, shared, 6)
          if (found.length && (a.to === b.to || a.from === b.from)) converging++
          for (const point of found) places.add(`${Math.round(point.x / 4)},${Math.round(point.y / 4)}`)
        }
      }
    }
  }
  return places.size + converging * 1000
}

/** Crossings with the routes that share an end with the group's, before it moves: placing it must not add any. */
function relatedCrossings(ctx: RoutingContext, all: readonly Segment[], group: readonly Segment[]): () => number {
  const outside = (segment: Segment) =>
    all.filter(other => !group.includes(other) && other.route && (other.to === segment.to || other.from === segment.from))
  return () =>
    group.reduce(
      (count, segment) =>
        count +
        outside(segment).filter(other =>
          ctx.quickCross(
            segment.route!,
            other.route!,
            [segment.end!, other.end!, ...(other.from === segment.from ? [segment.start] : [])],
            6,
          ),
        ).length,
      0,
    )
}
