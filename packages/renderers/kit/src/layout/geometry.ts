// Spline geometry of routes: rounded orthogonal routes and their straight runs.
import type {Point} from '../edge-arrows.js'
import {routeRadius} from '../routes/s-bend.js'
import {joinSplines, lineSpline} from '../splines.js'
import type {Spline} from '../splines.js'

/** Largest corner radius of a rounded orthogonal route, in layout units: the same as a drafted route's turns. */
const cornerRadius = routeRadius

/**
 * An orthogonal route as one smooth chain of cubics: collinear and repeated
 * points are dropped, and every corner becomes a quarter curve whose radius is
 * at most half of each adjacent leg, so a dogleg between layers reads as one
 * S-curve, the same as a spline route, and a short jog as a gentle wave rather
 * than a stair-step.
 */
export function roundedSpline(polyline: readonly Point[], radius = cornerRadius): Spline {
  const points: Point[] = []
  for (const point of polyline) {
    const last = points.at(-1)
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < 0.01) continue
    const previous = points.at(-2)
    // Collinear: extend the leg instead of adding a corner.
    if (previous && last && Math.abs((last.x - previous.x) * (point.y - last.y) - (last.y - previous.y) * (point.x - last.x)) < 0.01) {
      points[points.length - 1] = point
    } else points.push(point)
  }
  if (points.length < 3) return lineSpline(points[0]!, points.at(-1) ?? points[0]!)
  const leg = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y)
  const toward = (from: Point, to: Point, distance: number) => {
    const length = leg(from, to) || 1
    return {x: from.x + ((to.x - from.x) * distance) / length, y: from.y + ((to.y - from.y) * distance) / length}
  }
  // A corner's radius is shared with its neighbours: at most half of each leg it touches.
  const radii = points.map((_, index) =>
    index === 0 || index === points.length - 1
      ? 0
      : Math.min(radius, leg(points[index - 1]!, points[index]!) / 2, leg(points[index]!, points[index + 1]!) / 2),
  )
  let spline: Spline = [points[0]!]
  let cursor = points[0]!
  for (let index = 1; index < points.length - 1; index++) {
    const corner = points[index]!
    const enter = toward(corner, points[index - 1]!, radii[index]!)
    const leave = toward(corner, points[index + 1]!, radii[index]!)
    if (leg(cursor, enter) > 0.01) spline = joinSplines(spline, lineSpline(cursor, enter))
    // A quarter circle's cubic handles are 0.5523 of the radius; they meet at the corner for wide turns.
    const k = 0.5523
    spline = joinSplines(spline, [enter, toward(enter, corner, radii[index]! * k), toward(leave, corner, radii[index]! * k), leave])
    cursor = leave
  }
  return joinSplines(spline, lineSpline(cursor, points.at(-1)!))
}

/** A route's straight stretches longer than a unit. */
export function straightRuns(route: Spline): {from: Point; to: Point}[] {
  const result: {from: Point; to: Point}[] = []
  for (let index = 0; index + 3 < route.length; index += 3) {
    const [p0, p1, p2, p3] = route.slice(index, index + 4) as [Point, Point, Point, Point]
    const length = Math.hypot(p3.x - p0.x, p3.y - p0.y)
    if (length < 1) continue
    const off = (point: Point) => Math.abs((point.x - p0.x) * (p3.y - p0.y) - (point.y - p0.y) * (p3.x - p0.x)) / length
    if (off(p1) > 0.01 || off(p2) > 0.01) continue
    result.push({from: p0, to: p3})
  }
  return result
}
