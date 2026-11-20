// Two direct routes into one card that cross, swapped with their trunks.
import type {RoutingContext, Segment} from './context.js'
import {build} from './build.js'
import {runAt} from './runs.js'

/** A route's trunk: every route leaving the same port the same way, turning at the same place. */
function trunkOf(ctx: RoutingContext, segment: Segment): Segment[] {
  const signOf = (segment: Segment) => Math.sign(ctx.across(segment.end!) - ctx.across(segment.start))
  return ctx
    .all()
    .filter(
      other =>
        other.band &&
        Math.hypot(other.start.x - segment.start.x, other.start.y - segment.start.y) < 0.5 &&
        signOf(other) === signOf(segment) &&
        Math.abs(runAt(ctx, other) - runAt(ctx, segment)) < 0.5,
    )
}

/**
 * Two direct routes into one card that cross change places with their trunks, the one that should turn first
 * turning first, when that leaves fewer crossings among the routes they move; otherwise nothing moves.
 */
export function swapTrunks(ctx: RoutingContext, a: Segment, b: Segment): boolean {
  const {along} = ctx
  // Only routes that turn have runs to trade.
  if (Number.isNaN(runAt(ctx, a)) || Number.isNaN(runAt(ctx, b))) return false
  const [trunkA, trunkB] = [trunkOf(ctx, a), trunkOf(ctx, b)]
  const moving = [...trunkA, ...trunkB]
  const count = () => moving.reduce((sum, segment) => sum + ctx.crossingsOf(segment), 0)
  const before = count()
  const saved = moving.map(segment => segment.run)
  const [ra, rb] = [runAt(ctx, a), runAt(ctx, b)]
  for (const segment of trunkA) segment.run = rb - along(segment.start)
  for (const segment of trunkB) segment.run = ra - along(segment.start)
  moving.forEach(segment => build(ctx, segment))
  if (count() < before) return true
  moving.forEach((segment, index) => {
    if (saved[index] === undefined) delete segment.run
    else segment.run = saved[index]
    build(ctx, segment)
  })
  return false
}

/** Last, two direct routes into one card that still cross change places with their trunks. */
export function swapCrossingTrunks(ctx: RoutingContext): void {
  for (const list of ctx.incoming.values())
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const [a, b] = [list[i]!, list[j]!]
        if (a.band && b.band && ctx.quickCross(a.route!, b.route!, [a.end!, b.end!], 3)) swapTrunks(ctx, a, b)
      }
}
