// Builds one segment's route: one S through a clear gap, else a corridor between cards, else ELK's course.
import {arrowHeadReach} from '../../arrowhead.js'
import type {Point} from '../../edge-arrows.js'
import {gappedBend, routeRadius, routeTail} from '../../routes/s-bend.js'
import {portInset} from '../../routes/ports.js'
import {smoothRoute} from '../../routes/smooth.js'
import {roundedSpline} from '../geometry.js'
import {routeClearance, type RoutingContext, type Segment} from './context.js'
import {corridorRoute} from './corridor.js'

/**
 * Where a card's only route out leaves it: across from the port it enters, when that lies on the card's out face
 * (clear of its corners), so the route runs straight; otherwise the middle of the face.
 */
function slide(ctx: RoutingContext, segment: Segment) {
  const {along, across, at, box, breadth, outPort} = ctx
  const middle = across(box(segment.from)),
    wanted = across(segment.end!)
  const reach = breadth(segment.from) / 2 - portInset
  return at(along(outPort(segment.from)), Math.abs(wanted - middle) <= reach + 1e-6 ? wanted : middle)
}

// Along-axis gaps between the cards that lie across a route's span, widest first: where one S can turn.
function gaps(ctx: RoutingContext, segment: Segment, start: Point, end: Point) {
  const {along, across, box, depth, breadth, cards} = ctx
  const s0 = along(start),
    f0 = along(end) - (segment.lead ? arrowHeadReach : 0)
  const low = Math.min(across(start), across(end)) - routeClearance,
    high = Math.max(across(start), across(end)) + routeClearance
  const blocked: [number, number][] = []
  for (const id of cards) {
    if (id === segment.from || id === segment.to) continue
    const card = box(id)
    if (across(card) + breadth(id) / 2 < low || across(card) - breadth(id) / 2 > high) continue
    const near = along(card) - depth(id) / 2 - routeClearance,
      far = along(card) + depth(id) / 2 + routeClearance
    if (far > s0 && near < f0) blocked.push([Math.max(s0, near), Math.min(f0, far)])
  }
  blocked.sort((a, b) => a[0] - b[0])
  const open: [number, number][] = []
  let cursor = s0
  for (const [near, far] of blocked) {
    if (near > cursor) open.push([cursor, near])
    cursor = Math.max(cursor, far)
  }
  if (f0 > cursor) open.push([cursor, f0])
  return open
    .filter(([near, far]) => far - near >= 12)
    .toSorted((a, b) => b[1] - b[0] - (a[1] - a[0]) || b[0] - a[0])
    .map(([near, far]) => [near - s0, far - s0] as const)
}

export function build(ctx: RoutingContext, segment: Segment): void {
  const {along, axis, clear, firstGap} = ctx
  if (segment.slides) segment.start = slide(ctx, segment)
  const start = segment.start,
    end = segment.end!
  const own = [segment.from, segment.to]
  // One S, turning in the gap right after its source (so every route leaving one card the same way turns together:
  // one trunk), then running straight to its target; or across the whole span, or through the widest gap between
  // rows of cards that leaves it clear.
  const span = along(end) - (segment.lead ? arrowHeadReach : 0) - along(start)
  const tail = Math.min(routeTail, span / 4)
  const first = firstGap(segment.from) - along(start) - arrowHeadReach
  const candidates: (readonly [number, number])[] = [
    ...(!segment.late && first < span - 0.5 && first > 2 * routeRadius + tail ? [[0, first] as const] : []),
    [0, span],
    ...gaps(ctx, segment, start, end),
  ]
  // On a grid, whose courses around the cards go around them all (see `snapToGrid`), a route around the cards takes a
  // corridor between them where there is one, else one S like any other.
  const gridded = segment.around && ctx.input.grid
  if (gridded && corridor(ctx, segment, own)) return
  for (const [gapFrom, gapTo] of segment.around && !gridded ? [] : candidates) {
    const from = Math.max(gapFrom, tail),
      to = gapTo
    // A run moves off the band's middle only as far as both turns keep the full radius.
    const freedom = Math.max(0, (to - from) / 2 - routeRadius)
    const track = segment.run === undefined ? 0 : Math.max(-freedom, Math.min(freedom, segment.run - (from + to) / 2))
    const route = gappedBend(start, end, axis, from, to, {lead: segment.lead, track})
    if (route && clear(route, own)) {
      segment.route = route
      segment.bend = [from, span - to]
      segment.band = [from, to]
      if (track) segment.track = track
      else delete segment.track
      return
    }
  }
  delete segment.bend
  delete segment.band
  // Past cards in the way: an S into a clear corridor between them, straight along it, and an S into the port,
  // through the corridor that crosses fewest routes sharing an end with this one, then the shortest.
  if (!segment.around && corridor(ctx, segment, own)) return
  segment.route = elkCourse(ctx, segment, own)
}

/** Routes `segment` through a corridor between cards (see `corridorRoute`), if one is clear; whether it did. */
function corridor(ctx: RoutingContext, segment: Segment, own: readonly string[]): boolean {
  if (!ctx.cards.has(segment.to)) return false
  const end = segment.end!
  // The corridor for the same ports is found once (its choice weighs other routes only to break ties).
  const memo = `${segment.start.x},${segment.start.y},${end.x},${end.y},${segment.late ?? ''}`
  const known = ctx.corridors.get(segment)
  const route = known?.memo === memo ? known.route : corridorRoute(ctx, segment, own)
  ctx.corridors.set(segment, {memo, route})
  if (route) segment.route = route
  return Boolean(route)
}

/** ELK's course, moved onto this segment's ports where its first and last legs run along the axis. */
function elkCourse(ctx: RoutingContext, segment: Segment, own: readonly string[]) {
  const {along, across, at, axis, clear} = ctx
  const start = segment.start,
    end = segment.end!
  const polyline = ctx.input.polylines.get(segment.key)
  if (!polyline) throw new Error(`Graph layout did not produce a route for "${segment.key}".`)
  const course = polyline.map(point => ({...point}))
  const alongLeg = (a: Point, b: Point) => Math.abs(across(a) - across(b)) < 0.01
  if (course.length >= 2 && alongLeg(course[0]!, course[1]!) && Math.abs(along(course[0]!) - along(start)) < 1) {
    course[1] = at(along(course[1]!), across(start))
    course[0] = start
  }
  const n = course.length
  if (n >= 2 && alongLeg(course[n - 2]!, course[n - 1]!) && Math.abs(along(course[n - 1]!) - along(end)) < 1) {
    course[n - 2] = at(along(course[n - 2]!), across(end))
    course[n - 1] = end
  }
  const moved = smoothRoute(course, axis, {lead: segment.lead})
  // A leg moved onto a port must stay clear of cards; otherwise ELK's own course is kept.
  return moved && clear(moved, own) ? moved : (smoothRoute(polyline, axis, {lead: segment.lead}) ?? roundedSpline(polyline))
}
