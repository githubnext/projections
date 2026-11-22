// Trunks moved off neighbouring runs: every route leaving a port the same way turns at one place, clear of others.
import {trackSpacing} from '../../routes/tracks.js'
import {straightRuns} from '../geometry.js'
import type {RoutingContext, Segment} from './context.js'
import {fitsBands, moveRun, runAt, type Run} from './runs.js'

/** A run another trunk's runs keep a track away from. */
interface Neighbour {
  from: string
  along: number
  low: number
  high: number
}

/**
 * A direct run never lies beside a run of a route around cards (ELK's course) or another trunk's: each trunk moves
 * off along its band, as one; when it can't, the gap must grow by a track (`crowding`).
 */
export function moveTrunksOff(ctx: RoutingContext, all: readonly Segment[], runs: ReadonlyMap<Segment, Run>): void {
  const {along, across} = ctx
  const fixed: Neighbour[] = all
    .filter(segment => !segment.band && !!segment.route)
    .flatMap(segment =>
      straightRuns(segment.route!)
        .filter(run => Math.abs(along(run.to) - along(run.from)) < 0.01)
        .map(run => ({
          from: segment.from,
          along: along(run.from),
          low: Math.min(across(run.from), across(run.to)),
          high: Math.max(across(run.from), across(run.to)),
        })),
    )
  // A trunk moves as one: every route leaving its port the same way turns at the same place.
  const middleOf = (segment: Segment) => runAt(ctx, segment)
  const trunkOf = (segment: Segment) =>
    `${segment.start.x.toFixed(1)},${segment.start.y.toFixed(1)},${runs.get(segment)!.sign},${middleOf(segment).toFixed(0)}`
  const groups = new Map<string, Segment[]>()
  for (const segment of runs.keys()) groups.set(trunkOf(segment), [...(groups.get(trunkOf(segment)) ?? []), segment])
  for (const trunk of groups.values()) {
    // Other trunks' runs where they are now, and the runs of routes around cards.
    const near = [
      ...fixed,
      ...[...runs.keys()]
        .filter(segment => !trunk.includes(segment))
        .map(segment => ({from: segment.from, along: middleOf(segment), low: runs.get(segment)!.low, high: runs.get(segment)!.high})),
    ]
    const close = (position: number) =>
      trunk.some(segment => {
        const run = runs.get(segment)!
        return near.some(
          other =>
            other.from !== segment.from &&
            Math.abs(other.along - position) < trackSpacing - 0.01 &&
            Math.min(other.high, run.high) - Math.max(other.low, run.low) > 2,
        )
      })
    const now = Math.min(...trunk.map(middleOf))
    // Every member at the trunk's place (the earliest of them), or the whole trunk moved off a neighbour's run.
    const place = (position: number) =>
      trunk.every(segment => Math.abs(middleOf(segment) - position) < 0.01 || moveRun(ctx, segment, position))
    if (!close(now)) {
      place(now)
      continue
    }
    const span = Math.max(...trunk.map(segment => segment.band![1] - segment.band![0]))
    let moved = false
    // The nearest free places first; a few attempts at most.
    let attempts = 0
    for (let step = 0.5; step <= span && !moved && attempts < 6; step += 0.5) {
      for (const position of [now + step, now - step]) {
        if (fitsBands(ctx, trunk, position) && !close(position)) {
          attempts++
          if (place(position)) {
            moved = true
            break
          }
        }
      }
    }
    // No room to move off: the gap must grow by a track.
    if (!moved) ctx.crowding = Math.max(ctx.crowding, trackSpacing)
  }
}
