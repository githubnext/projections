// Routes converging on one card never cross: they turn early or late, swap trunks, take another way, or swap ports.
import {routeRadius} from '../../routes/s-bend.js'
import {routesCross} from '../../routes/crossings.js'
import {trackSpacing} from '../../routes/tracks.js'
import type {RoutingContext, Segment} from './context.js'
import {build} from './build.js'
import {assign, byLeaving} from './ports.js'
import {swapTrunks} from './trunk-swaps.js'

/** Staggers tried per route converging on one card; ordinary cards settle well within it. */
const staggerBudget = 3
/** The most staggers one card gets, however many routes converge on it. */
const staggerLimit = 48

export function untangleConverging(ctx: RoutingContext): void {
  for (const [target, list] of ctx.incoming) {
    if (list.length < 2) continue
    // Ports in the order the routes come from (where they leave their sources), as `assign` placed them first.
    const ordered = byLeaving(ctx, list)
    // Each stagger rebuilds routes and recounts their crossings: a hub's budget grows with its routes, so a card many
    // routes converge on (where untangling one pair can tangle another) can't take the whole layout's time.
    let staggers = Math.min(staggerBudget * list.length, staggerLimit)
    // Routes converging on one card never cross: swap neighbouring ports until none do.
    for (let round = 0; round < ordered.length * 2; round++) {
      let changed = false
      for (let i = 0; i < ordered.length; i++) {
        for (let j = i + 1; j < ordered.length; j++) {
          const [a, b] = [ordered[i]!, ordered[j]!]
          if (!crosses(a, b)) continue
          // Keep the order they come from: turn one before the other, or route one another way.
          if (staggers > 0 && (staggers--, stagger(ctx, a, b))) {
            changed = true
            continue
          }
          // Only if nothing else helps do neighbouring ports change places.
          if (j === i + 1) {
            ordered[i] = b
            ordered[j] = a
            assign(ctx, target, ordered)
            if (!crosses(b, a)) {
              changed = true
              continue
            }
            ordered[i] = a
            ordered[j] = b
            assign(ctx, target, ordered)
          }
        }
      }
      if (!changed) break
    }
  }
}

function crosses(a: Segment, b: Segment): boolean {
  return routesCross(a.route!, b.route!, [a.end!, b.end!, ...(a.from === b.from ? [a.start] : [])], a.from === b.from ? 6 : 3)
}

/** One route's turns moved early or late in its band, keeping the widest turns the band allows, then tighter ones. */
function stagger(ctx: RoutingContext, a: Segment, b: Segment): boolean {
  // A move that untangles the pair but crosses another route sharing an end with either is no move.
  const others = () => ctx.crossingsOf(a) + ctx.crossingsOf(b) - 2 * Number(crosses(a, b))
  const before = others()
  const fixed = () => !crosses(a, b) && others() <= before
  for (const segment of [a, b]) {
    if (!segment.band) continue
    const saved = segment.run
    const [low, high] = segment.band
    const middle = (low + high) / 2
    // Where its run is now: where it was moved, or the band's middle shifted by its track.
    const now = saved ?? middle + (segment.track ?? 0)
    // Early or late in its band, keeping full turns, at least a track from where it is.
    for (const run of [Math.min(middle, low + routeRadius), Math.max(middle, high - routeRadius)]) {
      if (Math.abs(run - now) < trackSpacing) continue
      segment.run = run
      build(ctx, segment)
      if (fixed() || recorridor(ctx, segment === a ? b : a, fixed)) return true
    }
    if (saved === undefined) delete segment.run
    else segment.run = saved
    build(ctx, segment)
  }
  // Or their trunks change places, so the routes leaving each port the same way still turn together.
  if (a.band && b.band && swapTrunks(ctx, a, b) && fixed()) return true
  // Or one gives up turning with its card's trunk, for a later gap; or, last, follows ELK's course around the cards.
  for (const flag of ['late', 'around'] as const) {
    for (const segment of [a, b]) {
      if (segment[flag]) continue
      segment[flag] = true
      build(ctx, segment)
      if (fixed()) return true
      delete segment[flag]
      build(ctx, segment)
    }
  }
  return false
}

/**
 * A route through a corridor between cards finds its corridor again, now that the other has moved: its turns then
 * keep a track from the other's run, and clear of it.
 */
function recorridor(ctx: RoutingContext, segment: Segment, fixed: () => boolean): boolean {
  if (segment.band || segment.around || !ctx.cards.has(segment.to)) return false
  const saved = {route: segment.route, corridor: ctx.corridors.get(segment)}
  ctx.corridors.delete(segment)
  build(ctx, segment)
  if (fixed()) return true
  if (saved.route) segment.route = saved.route
  if (saved.corridor) ctx.corridors.set(segment, saved.corridor)
  return false
}
