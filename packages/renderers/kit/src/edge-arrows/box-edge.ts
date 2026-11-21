// An arrow from one card to another, around the cards in its way.
import {getBoxToBoxArrow} from 'perfect-arrows'
import {arrowHeadLength as edgeArrowHeadLength} from '../arrowhead.js'
import {cardBorderOutset} from '../border.js'
import type {ArrowBox, Point} from '../edge-arrows.js'
import {sBend} from '../routes/s-bend.js'
import {lineSpline, sampleSpline, splinePath} from '../splines.js'
import {contains, outward} from './boxes.js'
import {boxEdgeTurn, corridorRoute, fitTrack} from './corridor.js'
import type {EdgeTurn} from './corridor.js'
import {flowingRoute} from './flowing.js'
import {routeAroundCards} from './grid.js'
import {finishArrow, roundedRoute} from './paths.js'

/** How far apart a blocked route's candidates are sampled to tell which cards they cross, in px along the curve. */
const overlapSpacing = 2

/**
 * An arrow from one card to another, around `obstacles`, ending at the base
 * of the kit's arrowhead (draw it with `EdgeArrowMarker`). Facing sides are
 * joined by the kit's one clean S (see `sBend`); a downward S blocked by a
 * card is drafted down the nearest clear corridor between cards instead, and
 * failing that the arrow is routed around the cards on a grid. The head's
 * painted tip stops `outset` outside the target's box, on the outer edge of
 * its border (see `cardBorderOutset`, the default for kit cards).
 *
 * @param from - The source card's box.
 * @param target - The target card's box.
 * @param obstacles - Other cards the arrow must not cross.
 * @param style - `curved` (the default) for flowing routes, `orthogonal` for straight runs with rounded corners.
 * @param ports - Where on the source and target boxes the arrow leaves and arrives, instead of the nearest sides.
 * @param outset - How far outside the target's box the head's tip stops.
 * @returns The path `d` (from `start` to the head's `base`), the endpoints with `end` at the head's tip, and the
 *   S turns a downward route takes, for `routeTracks`.
 * @throws `NoRouteError` when no route around the cards can be found (see `routeBoxEdge`, which returns that case),
 *   and `RangeError` for boxes that can't be joined at all, such as ones with non-finite coordinates.
 */
export function boxEdge(
  from: ArrowBox,
  target: ArrowBox,
  obstacles: ArrowBox[] = [],
  style: 'curved' | 'orthogonal' = 'curved',
  ports: {start?: Point; end?: Point} = {},
  outset = cardBorderOutset(),
  tracks: readonly number[] = [],
): BoxEdge {
  const routed = routeBoxEdge(from, target, obstacles, style, ports, outset, tracks)
  if ('blocked' in routed) throw new NoRouteError(routed)
  return routed
}

/** A `boxEdge` arrow: its path `d`, endpoints, and the S turns a downward route takes. */
export interface BoxEdge {
  /** The SVG path, from `start` to the head's `base`. */
  d: string
  /** Where the arrow leaves its source card. */
  start: Point
  /** The base of the arrowhead, where the path ends. */
  base: Point
  /** The head's tip, `outset` outside the target card. */
  end: Point
  /** The S turns a downward route takes, for `routeTracks`. */
  turns?: EdgeTurn[]
}

/**
 * No route around the cards exists (`routeBoxEdge`): `least` is the candidate that overlaps the obstacles least
 * (fewest cards crossed, then the shortest stretch inside them), and `crossed` the indices in `obstacles` it crosses.
 * Whether to draw it is the caller's policy, and drawing it should be reported.
 */
export interface BlockedBoxEdge {
  /** No route clears the cards. */
  blocked: true
  /** The candidate route that overlaps the obstacles least. */
  least: BoxEdge
  /** The indices in `obstacles` of the cards `least` crosses. */
  crossed: number[]
}

/** `boxEdge` found no route around the cards; `blocked` says which least-overlapping route there is. */
export class NoRouteError extends Error {
  /** `NoRouteError`. */
  override name = 'NoRouteError'
  constructor(readonly blocked: BlockedBoxEdge) {
    super('Cannot route an arrow around the cards.')
  }
}

/**
 * `boxEdge`, with no route around the cards as a result rather than an error: a `BlockedBoxEdge` with the
 * least-overlapping route, for the caller to draw and report or to refuse. Boxes that can't be joined at all still
 * throw a `RangeError`.
 */
export function routeBoxEdge(
  from: ArrowBox,
  target: ArrowBox,
  obstacles: ArrowBox[] = [],
  style: 'curved' | 'orthogonal' = 'curved',
  ports: {start?: Point; end?: Point} = {},
  outset = cardBorderOutset(),
  /**
   * Where a downward arrow's runs sit off their bands' middles, when they share a gap (see `RouteOptions.track`):
   * one per S it turns on (`turns` of the result), in order from its source.
   */
  tracks: readonly number[] = [],
): BoxEdge | BlockedBoxEdge {
  for (const box of [from, target, ...obstacles]) {
    if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width < 0 || box.height < 0) {
      throw new RangeError(`Cannot route an arrow with the card box ${JSON.stringify(box)}: boxes need finite coordinates and sizes.`)
    }
  }
  const to = {x: target.x - outset, y: target.y - outset, width: target.width + 2 * outset, height: target.height + 2 * outset}
  if (ports.end) {
    const [nx, ny] = outward(target, ports.end.x, ports.end.y)
    ports = {...ports, end: {x: ports.end.x + nx * outset, y: ports.end.y + ny * outset}}
  }
  const [sx, sy, , , ex, ey] = getBoxToBoxArrow(from.x, from.y, from.width, from.height, to.x, to.y, to.width, to.height, {
    bow: 0,
    padStart: 0,
    padEnd: 0,
  })
  if (sx === undefined || sy === undefined || ex === undefined || ey === undefined || ![sx, sy, ex, ey].every(Number.isFinite)) {
    throw new RangeError('Cannot join these cards with an arrow: their boxes have no finite edge points.')
  }
  const [sourceX, sourceY] = outward(from, sx, sy)
  const [targetX, targetY] = outward(to, ex, ey)
  const downward = to.y - (from.y + from.height) > 40 && (sourceX !== 0 || targetX !== 0)
  const centerFrom = from.x + from.width / 2,
    centerTo = to.x + to.width / 2
  const spread = (centerTo - centerFrom) * 0.22
  const start =
    ports.start ??
    (downward
      ? {x: Math.max(from.x + 20, Math.min(from.x + from.width - 20, centerFrom + spread)), y: from.y + from.height}
      : {x: sx, y: sy})
  const end =
    ports.end ?? (downward ? {x: Math.max(to.x + 20, Math.min(to.x + to.width - 20, centerTo - spread)), y: to.y} : {x: ex, y: ey})
  const [fromX, fromY] = ports.start ? outward(from, start.x, start.y) : downward ? [0, 1] : [sourceX, sourceY]
  const [toX, toY] = ports.end ? outward(to, end.x, end.y) : downward ? [0, -1] : [targetX, targetY]
  const handle = Math.min(64, Math.max(18, Math.hypot(end.x - start.x, end.y - start.y) * 0.35))
  const control1 = {x: start.x + fromX * handle, y: start.y + fromY * handle}
  const control2 = {x: end.x + toX * handle, y: end.y + toY * handle}
  // Leaving a card's side for the facing side of another card ahead: the kit's one clean S, like every graph route.
  const facing = fromX === -toX && fromY === -toY ? {x: fromX, y: fromY} : undefined
  const cards = [from, to, ...obstacles]
  const turn = facing?.y === 1 ? boxEdgeTurn(start, end, cards, outset) : undefined
  const s = facing ? sBend(start, end, facing, turn ? {band: turn.band, track: fitTrack(turn.band, tracks[0] ?? 0)} : {}) : undefined
  const direct = s
    ? {
        d: splinePath(
          s
            .slice(0, -3)
            .concat(
              lineSpline(s.at(-4)!, {x: end.x - facing!.x * edgeArrowHeadLength, y: end.y - facing!.y * edgeArrowHeadLength}).slice(1),
            ),
        ),
        start,
        base: {x: end.x - facing!.x * edgeArrowHeadLength, y: end.y - facing!.y * edgeArrowHeadLength},
        end,
        ...(turn ? {turns: [{start, end, axis: facing!, lead: true, band: turn.band}]} : {}),
      }
    : finishArrow(start, control1, control2, end)
  if (!obstacles.length && style === 'curved') return direct
  const length =
    Math.hypot(control1.x - start.x, control1.y - start.y) +
    Math.hypot(control2.x - control1.x, control2.y - control1.y) +
    Math.hypot(end.x - control2.x, end.y - control2.y)
  const left = Math.min(start.x, control1.x, control2.x, end.x) - 1
  const right = Math.max(start.x, control1.x, control2.x, end.x) + 1
  const top = Math.min(start.y, control1.y, control2.y, end.y) - 1
  const bottom = Math.max(start.y, control1.y, control2.y, end.y) + 1
  const intersects = obstacles.some(box => {
    if (s) return sampleSpline(s, 4).some(point => contains(box, point, 1))
    if (box.x > right || box.x + box.width < left || box.y > bottom || box.y + box.height < top) return false
    for (let step = 0, count = Math.max(1, Math.ceil(length / 4)); step <= count; step++) {
      const t = step / count,
        s = 1 - t
      if (
        contains(
          box,
          {
            x: s ** 3 * start.x + 3 * s ** 2 * t * control1.x + 3 * s * t ** 2 * control2.x + t ** 3 * end.x,
            y: s ** 3 * start.y + 3 * s ** 2 * t * control1.y + 3 * s * t ** 2 * control2.y + t ** 3 * end.y,
          },
          1,
        )
      ) {
        return true
      }
    }
    return false
  })
  if (!intersects && style === 'curved') return direct
  // Down past a card in the way: drafted like a graph route around cards, through the corridor between columns.
  if (s && style === 'curved') {
    const corridor = corridorRoute(start, end, obstacles, cards, edgeArrowHeadLength, [tracks[0] ?? 0, tracks[1] ?? 0], outset)
    if (corridor) return corridor
  }
  const sourceContacts = [
    {point: start, direction: {x: fromX, y: fromY}},
    {point: {x: from.x, y: from.y + from.height / 2}, direction: {x: -1, y: 0}},
    {point: {x: from.x + from.width, y: from.y + from.height / 2}, direction: {x: 1, y: 0}},
  ]
  const targetContacts = [
    {point: end, direction: {x: toX, y: toY}},
    {point: {x: to.x, y: to.y + to.height / 2}, direction: {x: -1, y: 0}},
    {point: {x: to.x + to.width, y: to.y + to.height / 2}, direction: {x: 1, y: 0}},
  ]
  const boxes = [from, to, ...obstacles]
  for (const targetContact of targetContacts) {
    for (const sourceContact of sourceContacts) {
      const route = routeAroundCards(sourceContact.point, targetContact.point, sourceContact.direction, targetContact.direction, boxes)
      if (!route) continue
      const base = {
        x: targetContact.point.x + targetContact.direction.x * edgeArrowHeadLength,
        y: targetContact.point.y + targetContact.direction.y * edgeArrowHeadLength,
      }
      return {
        d:
          style === 'orthogonal'
            ? roundedRoute(route, base, 8)
            : (flowingRoute(route, base, sourceContact.direction, targetContact.direction, obstacles) ?? roundedRoute(route, base)),
        start: sourceContact.point,
        end: targetContact.point,
        base,
      }
    }
  }
  // Nothing clears the cards: offer the direct arrow, or one from another side, whichever overlaps them least. Each
  // is sampled every `overlapSpacing` px along its curve, so no card it crosses falls between two samples.
  const candidates = [{route: direct, samples: sampleSpline(s ?? [start, control1, control2, end], overlapSpacing)}]
  for (const targetContact of targetContacts) {
    for (const sourceContact of sourceContacts) {
      const reach = Math.min(
        64,
        Math.max(18, Math.hypot(targetContact.point.x - sourceContact.point.x, targetContact.point.y - sourceContact.point.y) * 0.35),
      )
      const c1 = {
        x: sourceContact.point.x + sourceContact.direction.x * reach,
        y: sourceContact.point.y + sourceContact.direction.y * reach,
      }
      const c2 = {
        x: targetContact.point.x + targetContact.direction.x * reach,
        y: targetContact.point.y + targetContact.direction.y * reach,
      }
      candidates.push({
        route: finishArrow(sourceContact.point, c1, c2, targetContact.point),
        samples: sampleSpline([sourceContact.point, c1, c2, targetContact.point], overlapSpacing),
      })
    }
  }
  const scored = candidates.map(({route, samples}) => {
    const crossed = obstacles.flatMap((box, index) => (samples.some(point => contains(box, point)) ? [index] : []))
    const inside = samples.filter(point => obstacles.some(box => contains(box, point))).length
    return {route, crossed, inside}
  })
  const least = scored.reduce((best, next) =>
    next.crossed.length < best.crossed.length || (next.crossed.length === best.crossed.length && next.inside < best.inside) ? next : best,
  )
  return {blocked: true, least: least.route, crossed: least.crossed}
}
