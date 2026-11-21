// A route through a clear corridor between cards: an S into it, straight along it, and an S into the port.
import {arrowHeadReach} from '../../arrowhead.js'
import {routeRadius, routeTail} from '../../routes/s-bend.js'
import {smoothRoute} from '../../routes/smooth.js'
import {trackSpacing} from '../../routes/tracks.js'
import type {Spline} from '../../splines.js'
import {routeClearance} from './context.js'
import type {RoutingContext, Segment} from './context.js'

interface Attempt {
  route: Spline
  score: number
  close: number
  value: number
  crossings: number
}

/**
 * Past cards in the way: an S into a clear corridor between them, straight along it, and an S into the port,
 * through the corridor that crosses fewest routes sharing an end with this one, then the shortest.
 */
export function corridorRoute(ctx: RoutingContext, segment: Segment, own: readonly string[]): Spline | undefined {
  const {along, across, box, depth, breadth, cards, firstGap, previousLayer} = ctx
  const start = segment.start,
    end = segment.end!
  const finish = along(end) - (segment.lead ? arrowHeadReach : 0)
  const first = (along(start) + Math.min(routeTail, (finish - along(start)) / 4) + firstGap(segment.from) - arrowHeadReach) / 2
  const last = (previousLayer(segment.to) + finish) / 2
  if (!Number.isFinite(first) || !Number.isFinite(last) || last - first < 2 * routeRadius) return undefined
  if (first - along(start) < routeRadius || finish - last < routeRadius) return undefined
  // Cards beside the corridor: those between its two turns. Cards with no relationships block it, but no corridor runs
  // along them, between them and the rest.
  const near = [...cards].filter(id => !own.includes(id) && along(box(id)) + depth(id) / 2 > first && along(box(id)) - depth(id) / 2 < last)
  const beside = near.filter(id => !ctx.input.loose?.has(id))
  const edges = [
    ...new Set(
      beside.flatMap(id => [across(box(id)) - breadth(id) / 2 - routeClearance, across(box(id)) + breadth(id) / 2 + routeClearance]),
    ),
  ].sort((a, b) => a - b)
  if (!edges.length) return undefined
  const blocked = (value: number) => near.some(id => Math.abs(value - across(box(id))) < breadth(id) / 2 + routeClearance)
  const candidates = [edges[0]! - routeRadius, edges.at(-1)! + routeRadius]
  for (let index = 0; index + 1 < edges.length; index++) candidates.push((edges[index]! + edges[index + 1]!) / 2)
  const attempt = corridorAttempt(ctx, segment, own, first, last)
  let best: Attempt | undefined
  // The four shortest clear corridors.
  const nearest = candidates
    .filter(value => !blocked(value))
    .sort((a, b) => Math.abs(a - across(start)) + Math.abs(a - across(end)) - Math.abs(b - across(start)) - Math.abs(b - across(end)))
    .slice(0, 4)
  // Shortest first: the first with no crossings and nothing beside it is the best there is.
  for (const value of nearest) {
    const tried = attempt.route(value, first, last, best?.score)
    if (tried && (!best || tried.score < best.score)) best = tried
    if (best && !best.crossings && !best.close) break
  }
  // Turns beside another route's run move a track or two either way, where they keep the full radius.
  if (best && best.close) best = shiftTurns(ctx, segment, attempt, best, first, last, finish)
  return best?.route
}

/** Corridor routes for one segment along the corridor at `value`, turning at `jog` and `turn`, scored. */
function corridorAttempt(ctx: RoutingContext, segment: Segment, own: readonly string[], first: number, last: number) {
  const {across, at, axis, clear, crossRuns, quickCross} = ctx
  const start = segment.start,
    end = segment.end!
  const others = ctx.sharingAnEnd(segment).filter(other => other !== segment && other.route)
  // Other routes' runs across the layers, which this one's runs keep a track away from.
  const runs = ctx.all().flatMap(other => (other !== segment && other.route ? crossRuns(other.route) : []))
  const crowded = (position: number, from: number, to: number) =>
    runs.filter(
      run =>
        Math.abs(run.along - position) < trackSpacing - 0.01 &&
        Math.min(run.high, Math.max(from, to)) - Math.max(run.low, Math.min(from, to)) > 2,
    ).length
  // An attempt that can't score below `beat` (the best so far) is dropped as soon as that is certain: each crossing
  // outweighs everything else, so counting stops at the first one too many.
  const route = (value: number, jog: number, turn: number, beat = Infinity): Attempt | undefined => {
    if (turn - jog < 2 * routeRadius) return undefined
    const course = [start, at(jog, across(start)), at(jog, value), at(turn, value), at(turn, across(end)), end]
    const smoothed = smoothRoute(course, axis, {lead: segment.lead})
    if (!smoothed || !clear(smoothed, own)) return undefined
    const close = crowded(jog, across(start), value) + crowded(turn, value, across(end))
    const base =
      close * 1e3 + Math.abs(value - across(start)) + Math.abs(value - across(end)) + Math.abs(jog - first) + Math.abs(turn - last)
    // Clear of rounding: only an attempt certain to lose is dropped.
    const loses = (count: number) => count * 1e6 + base > beat + 1
    let crossings = 0
    for (let index = 0; index < others.length; index++) {
      if (loses(crossings)) return undefined
      const other = others[index]!
      if (
        quickCross(
          smoothed,
          other.route!,
          [end, other.end!, ...(other.from === segment.from ? [start] : [])],
          other.from === segment.from ? 6 : 3,
        )
      ) {
        crossings++
        // The next attempts, a corridor or turn away, most likely cross it too: tested first, they reach a count certain
        // to lose sooner. Order changes nothing else, as an attempt is dropped only when no order could save it.
        if (index) others.unshift(...others.splice(index, 1))
      }
    }
    if (loses(crossings)) return undefined
    const score =
      crossings * 1e6 +
      close * 1e3 +
      Math.abs(value - across(start)) +
      Math.abs(value - across(end)) +
      Math.abs(jog - first) +
      Math.abs(turn - last)
    return {route: smoothed, score, close, value, crossings}
  }
  return {route, crowded}
}

/** The best corridor route's turns moved a track or two either way, off another route's run. */
function shiftTurns(
  ctx: RoutingContext,
  segment: Segment,
  attempt: ReturnType<typeof corridorAttempt>,
  found: Attempt,
  first: number,
  last: number,
  finish: number,
): Attempt {
  const {along, across, firstGap, previousLayer} = ctx
  const start = segment.start,
    end = segment.end!
  let best = found
  const shifts = [0, -trackSpacing, trackSpacing, -2 * trackSpacing, 2 * trackSpacing]
  const firstLimit = firstGap(segment.from) - arrowHeadReach - routeRadius
  const firsts = shifts
    .map(shift => first + shift)
    .filter(value => value - along(start) >= routeRadius + 8 - 0.01 && value <= firstLimit + 0.01)
  const lasts = shifts
    .map(shift => last + shift)
    .filter(value => finish - value >= routeRadius - 0.01 && value - previousLayer(segment.to) >= routeRadius - 0.01)
  const value = best.value
  // Least crowded first (counted without building a route); the first clear of crossings and runs is taken.
  const pairs = firsts
    .flatMap(jog =>
      lasts.map(turn => ({jog, turn, close: attempt.crowded(jog, across(start), value) + attempt.crowded(turn, value, across(end))})),
    )
    .filter(pair => best.crossings || pair.close < best.close)
    .sort(
      (a, b) => a.close - b.close || Math.abs(a.jog - first) + Math.abs(a.turn - last) - Math.abs(b.jog - first) - Math.abs(b.turn - last),
    )
  // A crossing is worth the whole search; crowding alone, the few least crowded.
  for (const {jog, turn} of best.crossings ? pairs : pairs.slice(0, 6)) {
    const tried = attempt.route(value, jog, turn, best.score)
    if (tried && tried.score < best.score) best = tried
    if (!best.crossings && !best.close) break
  }
  return best
}
