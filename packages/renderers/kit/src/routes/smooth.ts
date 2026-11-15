// Orthogonal polylines as chains of clean S bends.
import {arrowHeadReach} from '../arrowhead.js'
import type {Point} from '../edge-arrows.js'
import {joinSplines, lineSpline} from '../splines.js'
import type {Spline} from '../splines.js'
import {routeRadius, sBend, tidyRoute} from './s-bend.js'
import type {RouteOptions} from './s-bend.js'
import {add, frame} from './vector.js'

/** A polyline without repeated points and with collinear runs merged. */
export function cleanPolyline(polyline: readonly Point[]): Point[] {
  const points: Point[] = []
  for (const point of polyline) {
    const last = points.at(-1)
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < 0.01) continue
    const previous = points.at(-2)
    if (previous && last && Math.abs((last.x - previous.x) * (point.y - last.y) - (last.y - previous.y) * (point.x - last.x)) < 0.01)
      points[points.length - 1] = point
    else points.push(point)
  }
  return points
}

/**
 * An orthogonal route (legs along and across the axis, as ELK's router draws
 * them around cards) as a chain of clean S bends: every jog across the axis
 * becomes one S centred on it, using up to half of each neighbouring leg, so
 * the route keeps ELK's course and has one inflection per jog. Undefined when
 * the route doesn't alternate legs along and across the axis, moving forward
 * along it (a route that loops back).
 */
export function smoothRoute(polyline: readonly Point[], axis: Point, options: RouteOptions = {}): Spline | undefined {
  const lead = options.lead ?? true
  const f = frame(axis)
  const points = cleanPolyline(polyline)
  if (points.length < 2) return undefined
  const isAlong = (a: Point, b: Point) => Math.abs(f.across(b) - f.across(a)) < 0.01 && f.along(b) - f.along(a) > 0.01
  const isAcross = (a: Point, b: Point) => Math.abs(f.along(b) - f.along(a)) < 0.01
  // Legs alternate along, across, along, …, along.
  if (points.length % 2) return undefined
  for (let index = 0; index + 1 < points.length; index++) {
    if (index % 2 ? !isAcross(points[index]!, points[index + 1]!) : !isAlong(points[index]!, points[index + 1]!)) return undefined
  }
  const end = points.at(-1)!
  const reach = lead ? arrowHeadReach : 0
  // The along legs are shared by the jogs on either side of them; the first and last belong to one jog each.
  const legs: number[] = []
  for (let index = 0; index + 1 < points.length; index += 2) legs.push(f.along(points[index + 1]!) - f.along(points[index]!))
  legs[legs.length - 1]! -= reach
  if (legs.at(-1)! < 2) return undefined
  let route: Spline = [points[0]!]
  let cursor = points[0]!
  for (let jog = 0; jog < legs.length - 1; jog++) {
    const corner = points[jog * 2 + 1]!,
      next = points[jog * 2 + 2]!
    const before = jog === 0 ? legs[0]! : legs[jog]! / 2
    const after = jog === legs.length - 2 ? legs.at(-1)! : legs[jog + 1]! / 2
    // ELK keeps its legs a full turn clear of cards (see the layout's ELK spacing); an S no taller never cuts a corner into one.
    const half = Math.min(before, after, routeRadius)
    const from = f.point(f.along(corner) - half, f.across(corner)),
      to = f.point(f.along(next) + half, f.across(next))
    if (Math.hypot(from.x - cursor.x, from.y - cursor.y) > 0.5) route = joinSplines(route, lineSpline(cursor, from))
    route = joinSplines(route, sBend(from, to, axis, {lead: false, band: [0, 2 * half]}) ?? lineSpline(from, to))
    cursor = to
  }
  const finish = add(end, axis, -reach)
  if (Math.hypot(finish.x - cursor.x, finish.y - cursor.y) > 0.5) route = joinSplines(route, lineSpline(cursor, finish))
  return tidyRoute(reach ? joinSplines(route, lineSpline(finish, end)) : route)
}
