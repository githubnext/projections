// A direct segment's run across its gap: where it is, and moving it.
import {routeRadius, sTurn} from '../../routes/s-bend.js'
import type {Turn} from '../../routes/s-bend.js'
import type {RoutingContext, Segment} from './context.js'
import {build} from './build.js'

/** A direct segment's run across the gap it turns in. */
export interface Run {
  along: number
  low: number
  high: number
  sign: number
  middle: number
}

/** The S a direct segment turns on (it has a band). */
export function turnOf(ctx: RoutingContext, segment: Segment): Turn | null | undefined {
  return sTurn(segment.start, segment.end!, ctx.axis, {lead: segment.lead, band: segment.band!, track: segment.track ?? 0})
}

/**
 * Where a direct segment's run crosses its gap, along the axis; NaN when it has no S to run on (its ends are in line, or
 * the gap is too short to turn in), so it matches no other run and never moves.
 */
export function runAt(ctx: RoutingContext, segment: Segment): number {
  const turn = turnOf(ctx, segment)
  return turn ? ctx.along(segment.start) + turn.middle : NaN
}

/** Moves a route's run to `position` (along the axis) if it can turn there clear of cards; otherwise leaves it. */
export function moveRun(ctx: RoutingContext, segment: Segment, position: number): boolean {
  const saved = segment.run
  const before = ctx.crossingsOf(segment)
  segment.run = position - ctx.along(segment.start)
  build(ctx, segment)
  if (segment.band && Math.abs(runAt(ctx, segment) - position) < 0.05 && ctx.crossingsOf(segment) <= before) return true
  if (saved === undefined) delete segment.run
  else segment.run = saved
  build(ctx, segment)
  return false
}

/** Puts a segment's run back where it was (`run` undefined: its band's middle), and rebuilds it. */
export function restoreRun(ctx: RoutingContext, segment: Segment, run: number | undefined): void {
  if (run === undefined) delete segment.run
  else segment.run = run
  build(ctx, segment)
}

/** Whether a run at `position` keeps full turns in every member's band. */
export function fitsBands(ctx: RoutingContext, trunk: readonly Segment[], position: number): boolean {
  return trunk.every(segment => {
    const relative = position - ctx.along(segment.start)
    return relative - segment.band![0] >= routeRadius - 0.01 && segment.band![1] - relative >= routeRadius - 0.01
  })
}
