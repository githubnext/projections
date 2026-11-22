/**
 * Relationship routes as one clean S, built like a drafted connector: a
 * straight stub leaves the source perpendicular to its face, a quarter circle
 * turns across, a straight run crosses the gap at right angles to the layers,
 * a second quarter circle turns back, and a straight stub enters the target
 * perpendicular to its face, ending with the arrowhead's lead-in. No straight
 * stretch is ever diagonal, every join is tangent-continuous, and a route has
 * one inflection. Both turns share one radius: `routeRadius`, or less when the
 * room along the axis is short. A sideways offset under two radii has no run:
 * the two arcs meet directly, turning less than 90°, so a small offset is a
 * gentle wave rather than two tight hooks.
 */

// One clean S: its geometry (`sTurn`) and its drawing (`sBend`, `gappedBend`), and tidying short slivers.
import {arrowHeadReach} from '../arrowhead.js'
import type {Point} from '../edge-arrows.js'
import {joinSplines, lineSpline, type Spline} from '../splines.js'
import {add, dot} from './vector.js'

/**
 * The largest radius of a route's turns, in drawing units (CSS px at a zoom of 1): wide enough to read as one
 * drafted S, tight enough that layers stay close (see `layerGap`).
 */
export const routeRadius = 20
/** Shortest straight stub leaving a source before a route turns. */
export const routeTail = 8

/**
 * A route without stretches shorter than half a unit (the slivers floating-point
 * joins leave): each is dropped and the next stretch starts where the previous
 * one ends, its first handle moved with it, so every remaining join has a
 * direction on both sides.
 */
export function tidyRoute(route: Spline, shortest = 0.5): Spline {
  if (route.length <= 4) return route
  const result: Point[] = [route[0]!]
  for (let index = 0; index + 3 < route.length; index += 3) {
    const [p0, p1, p2, p3] = route.slice(index, index + 4) as [Point, Point, Point, Point]
    const span = Math.hypot(p1.x - p0.x, p1.y - p0.y) + Math.hypot(p2.x - p1.x, p2.y - p1.y) + Math.hypot(p3.x - p2.x, p3.y - p2.y)
    const last = index + 4 >= route.length
    if (span < shortest && result.length > 1 && !last) continue
    const start = result.at(-1)!
    const shift = {x: start.x - p0.x, y: start.y - p0.y}
    if (span < shortest && last && result.length > 1) {
      // The last sliver: the stretch before it ends where the route must.
      const delta = {x: p3.x - start.x, y: p3.y - start.y}
      result[result.length - 1] = p3
      result[result.length - 2] = {x: result.at(-2)!.x + delta.x, y: result.at(-2)!.y + delta.y}
      continue
    }
    result.push({x: p1.x + shift.x, y: p1.y + shift.y}, p2, p3)
  }
  return result
}

/** One circular arc of radius `radius` turning by `angle` (≤ 90°), as a cubic, from `start` heading `from` to heading `to`. */
function arc(start: Point, end: Point, from: Point, to: Point, radius: number, angle: number): Spline {
  const handle = (4 / 3) * Math.tan(angle / 4) * radius
  return [start, add(start, from, handle), add(end, to, -handle), end]
}

/** How `sBend` and `sTurn` shape an S; every option has a default. */
export interface RouteOptions {
  /** End with the arrowhead's straight lead-in (`arrowHeadReach` long); default true. */
  lead?: boolean
  /**
   * Where along the axis the S may turn, as distances from `start`: the stubs
   * fill the rest. Defaults to everything after `routeTail` (when there is
   * room for it) up to the lead-in.
   */
  band?: readonly [number, number]
  /** Moves the S's middle (its crossing run) this far along the axis from the band's middle: a track in a shared gap. */
  track?: number
  /** Largest turn radius; default `routeRadius`. */
  radius?: number
}

/** How an S turns: its middle along the axis (from `start`), radius and turn angle, or undefined for a straight route. */
export interface Turn {
  /** Where the S's middle (its crossing run) is, as a distance along the axis from `start`, inside `band`. */
  middle: number
  /** The radius both turns share: `RouteOptions.radius` (default `routeRadius`), or less when the band is short. */
  radius: number
  /** How far each turn bends, in radians: π/2 with a crossing run, less when a small offset makes the arcs meet. */
  angle: number
  /** Signed distance across the axis from start to finish. */
  across: number
  /** Where the turns are confined, as distances from `start`. */
  band: readonly [number, number]
}

/** The geometry `sBend` draws, without drawing it. */
export function sTurn(start: Point, end: Point, axis: Point, options: RouteOptions = {}): Turn | null | undefined {
  const lead = options.lead ?? true
  const finish = add(end, axis, lead ? -arrowHeadReach : 0)
  const length = dot({x: finish.x - start.x, y: finish.y - start.y}, axis)
  const across = dot({x: finish.x - start.x, y: finish.y - start.y}, {x: -axis.y, y: axis.x})
  if (length < 2) return undefined
  if (Math.abs(across) < 0.01) return null
  const [from, to] = options.band ?? [Math.min(routeTail, length / 4), length]
  const low = Math.max(0, from),
    high = Math.min(length, to)
  if (high - low < 2) return undefined
  // The middle keeps a little room for both turns, however far a track moves it.
  const margin = Math.min(4, (high - low) / 2)
  let middle = Math.max(low + margin, Math.min(high - margin, (low + high) / 2 + (options.track ?? 0)))
  const largest = options.radius ?? routeRadius
  // A stub shorter than half a unit would be absorbed into the turn: the turn starts or ends at the band's edge instead.
  if (middle - largest - low > 0 && middle - largest - low < 0.5) middle = low + largest
  if (high - middle - largest > 0 && high - middle - largest < 0.5) middle = high - largest
  const radius = Math.min(largest, middle - low, high - middle)
  // Two quarter circles and a run when the offset allows; otherwise two shallower arcs that meet.
  const angle = Math.abs(across) >= 2 * radius ? Math.PI / 2 : Math.acos(1 - Math.abs(across) / (2 * radius))
  return {middle, radius, angle, across, band: [low, high]}
}

/**
 * The S from `start` to `end`, leaving and arriving along `axis` (a unit
 * vector: down for a top-to-bottom graph, right for left to right). Undefined
 * when `end` is not far enough ahead of `start` along the axis for one.
 */
export function sBend(start: Point, end: Point, axis: Point, options: RouteOptions = {}): Spline | undefined {
  const lead = options.lead ?? true
  const finish = add(end, axis, lead ? -arrowHeadReach : 0)
  const turn = sTurn(start, end, axis, options)
  if (turn === undefined) return undefined
  const tail = (route: Spline) => (lead ? joinSplines(route, lineSpline(finish, end)) : route)
  if (turn === null) return tail(lineSpline(start, finish))
  const {middle, radius, angle, across} = turn
  const side = {x: -axis.y * Math.sign(across), y: axis.x * Math.sign(across)}
  const reach = radius * Math.sin(angle),
    rise = radius * (1 - Math.cos(angle))
  const heading = add({x: axis.x * Math.cos(angle), y: axis.y * Math.cos(angle)}, side, Math.sin(angle))
  // Stub, first arc, the run across (none when the arcs meet), second arc, stub.
  // Stubs and runs shorter than half a unit are absorbed into the turns, so no stretch is too short to have a direction.
  const stubIn = middle - reach > 0.5
  const turnIn = stubIn ? add(start, axis, middle - reach) : start
  const runStart = add(add(turnIn, axis, reach), side, rise)
  const hasRun = Math.abs(across) - 2 * rise > 0.5
  const runEnd = hasRun ? add(runStart, side, Math.abs(across) - 2 * rise) : runStart
  const turnOut = add(add(runEnd, axis, reach), side, rise)
  const stubOut = dot({x: finish.x - turnOut.x, y: finish.y - turnOut.y}, axis) > 0.5
  let route: Spline = stubIn ? lineSpline(start, turnIn) : [start]
  route = joinSplines(route, arc(turnIn, runStart, axis, heading, radius, angle))
  if (hasRun) route = joinSplines(route, lineSpline(runStart, runEnd))
  route = joinSplines(route, arc(runEnd, stubOut ? turnOut : finish, heading, axis, radius, angle))
  if (stubOut) route = joinSplines(route, lineSpline(turnOut, finish))
  return tidyRoute(tail(route))
}

/**
 * The S confined to `[from, to]` along the axis (distances from `start`):
 * straight stubs outside it. Used to fit an S through the gap between two
 * rows of cards when a full-height one would cross a card.
 */
export function gappedBend(
  start: Point,
  end: Point,
  axis: Point,
  from: number,
  to: number,
  options: RouteOptions = {},
): Spline | undefined {
  if (to - from < 2) return undefined
  return sBend(start, end, axis, {...options, band: [from, to]})
}
