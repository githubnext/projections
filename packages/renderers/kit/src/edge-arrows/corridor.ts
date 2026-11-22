// Downward arrows' S turns, and drafted routes down a corridor between cards.
import {arrowHeadReach} from '../arrowhead.js'
import {cardBorderOutset} from '../border.js'
import type {ArrowBox, Point} from '../edge-arrows.js'
import {routeRadius, routeTail} from '../routes/s-bend.js'
import {smoothRoute} from '../routes/smooth.js'
import {lineSpline, sampleSpline, splinePath} from '../splines.js'
import {clearance, contains} from './boxes.js'

/**
 * Where a downward arrow's S turns: in the gap right below its source (up to
 * the next row of cards), so every arrow leaving one card turns together, as
 * one trunk. Undefined when the target is in that next row (the whole span).
 */
function firstBand(start: Point, end: Point, cards: readonly ArrowBox[], outset: number): [number, number] | undefined {
  const next = Math.min(...cards.map(box => box.y).filter(y => y > start.y + 1))
  const span = end.y - arrowHeadReach - start.y
  // Measured to where a head into the next row would stop, so every arrow from one card turns in the same place.
  const high = next - outset - arrowHeadReach - start.y
  return Number.isFinite(high) && high < span - 0.5 && high > routeTail + 2 * routeRadius
    ? [Math.min(routeTail, span / 4), high]
    : undefined
}

/**
 * The S a downward `boxEdge` arrow turns on (its band and middle, see
 * `sTurn`), for spreading arrows that share a gap onto separate tracks
 * (`routeTracks`) before routing them. Undefined unless the arrow leaves a
 * card's bottom for another's top.
 */
export function boxEdgeTurn(
  start: Point,
  end: Point,
  cards: readonly ArrowBox[],
  outset = cardBorderOutset(),
): {band: readonly [number, number]} | undefined {
  if (end.y - start.y <= arrowHeadReach) return undefined
  const span = end.y - arrowHeadReach - start.y
  return {band: firstBand(start, end, cards, outset) ?? [Math.min(routeTail, span / 4), span]}
}

/** One S a downward `boxEdge` arrow turns on, as `routeTracks` takes it. */
export interface EdgeTurn {
  /** Where the S starts: the arrow's start for its first S. */
  start: Point
  /** Where the S ends: the arrow's tip for its last S. */
  end: Point
  /** The unit direction the S leaves and arrives along: down, for `boxEdge`'s downward arrows. */
  axis: Point
  /** Whether the S ends with the arrowhead's lead-in: true for the S into the target, false for one into a corridor. */
  lead: boolean
  /** Where along `axis` the S may turn, as distances from `start`. */
  band: readonly [number, number]
}

/** A track's offset, kept to where both of the S's turns keep the full radius in its band. */
export const fitTrack = (band: readonly [number, number], track: number) => {
  const freedom = Math.max(0, (band[1] - band[0]) / 2 - routeRadius)
  return Math.max(-freedom, Math.min(freedom, track))
}

/**
 * A downward arrow from `start` to `end` around the cards in its way, drafted:
 * one S in the gap below its source (where its card's other arrows turn, as
 * one trunk) into the nearest clear corridor between cards, straight down it,
 * and one S in the gap above its target, ending at the arrowhead's base; each
 * S's run on its track (`tracks`). Undefined when no corridor is clear.
 */
export function corridorRoute(
  start: Point,
  end: Point,
  obstacles: readonly ArrowBox[],
  cards: readonly ArrowBox[],
  headLength: number,
  tracks: readonly [number, number],
  outset: number,
) {
  const axis = {x: 0, y: 1}
  const span = end.y - arrowHeadReach - start.y
  const next = Math.min(...cards.map(box => box.y).filter(y => y > start.y + 1))
  const above = Math.max(...cards.map(box => box.y + box.height).filter(y => y < end.y - 1))
  if (!Number.isFinite(next) || !Number.isFinite(above)) return undefined
  const upperBand = [Math.min(routeTail, span / 4), next - outset - arrowHeadReach - start.y] as const
  const lowerBand = [above - start.y, span] as const
  const first = start.y + (upperBand[0] + upperBand[1]) / 2 + fitTrack(upperBand, tracks[0]),
    last = start.y + (lowerBand[0] + lowerBand[1]) / 2 + fitTrack(lowerBand, tracks[1])
  if (last - first < 2 * routeRadius || upperBand[1] - upperBand[0] < 2 * routeRadius || lowerBand[1] - lowerBand[0] < 2 * routeRadius) {
    return undefined
  }
  // Cards the corridor runs beside: those between the two turns.
  const beside = obstacles.filter(box => box.y + box.height > first && box.y < last)
  const edges = [...new Set(beside.flatMap(box => [box.x - clearance, box.x + box.width + clearance]))].toSorted((a, b) => a - b)
  const blocked = (x: number) => beside.some(box => x > box.x - clearance && x < box.x + box.width + clearance)
  const candidates = edges.length ? [edges[0]! - routeRadius, edges.at(-1)! + routeRadius] : []
  for (let index = 0; index + 1 < edges.length; index++) candidates.push((edges[index]! + edges[index + 1]!) / 2)
  const cost = (x: number) => Math.abs(x - start.x) + Math.abs(x - end.x)
  for (const x of candidates.filter(candidate => !blocked(candidate)).sort((a, b) => cost(a) - cost(b))) {
    const course = [start, {x: start.x, y: first}, {x, y: first}, {x, y: last}, {x: end.x, y: last}, end]
    const route = smoothRoute(course, axis)
    if (!route) continue
    if (obstacles.some(box => sampleSpline(route, 4).some(point => contains(box, point, 1)))) continue
    const base = {x: end.x, y: end.y - headLength}
    const turns: EdgeTurn[] = [
      {start, end: {x, y: start.y + upperBand[1]}, axis, lead: false, band: upperBand},
      {start: {x, y: start.y}, end, axis, lead: true, band: lowerBand},
    ]
    return {d: splinePath(route.slice(0, -3).concat(lineSpline(route.at(-4)!, base).slice(1))), start, base, end, turns}
  }
  return undefined
}
