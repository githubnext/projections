// Routes between two layouts: interpolated, held as one S, or straight between faces.
import type {Point} from '../edge-arrows.js'
import type {GraphLayout} from '../layout.js'
import {arrowHeadReach} from '../arrowhead.js'
import {smoothstep} from '../motion.js'
import {gappedBend} from '../routes/s-bend.js'
import {interpolateSpline, lineSpline, type Spline} from '../splines.js'

export function interpolate(a: number, b: number, progress: number): number {
  return a + (b - a) * progress
}

/**
 * A route that is one S in every layout that has it (`RoutePorts.bend`), as
 * that S between its cards where they are now, with its ports and bend
 * interpolated: it never stops being one clean S while its cards move.
 */
export function directRoute(
  key: string,
  from: GraphLayout,
  to: GraphLayout,
  mix: number,
  source: Point,
  target: Point,
  axis: Point,
): Spline | undefined {
  const a = from.ports.get(key),
    b = to.ports.get(key)
  const p = a ?? b,
    q = b ?? a
  if (!p?.bend || !q?.bend) return undefined
  const lerp = (u: Point, v: Point) => ({x: interpolate(u.x, v.x, mix), y: interpolate(u.y, v.y, mix)})
  const start = lerp(p.from, q.from),
    end = lerp(p.to, q.to)
  const startPoint = {x: source.x + start.x, y: source.y + start.y},
    endPoint = {x: target.x + end.x, y: target.y + end.y}
  const span = (endPoint.x - startPoint.x) * axis.x + (endPoint.y - startPoint.y) * axis.y - arrowHeadReach
  const before = interpolate(p.bend[0], q.bend[0], mix),
    after = interpolate(p.bend[1], q.bend[1], mix)
  // While cards close a gap, the bend keeps its share of the span.
  const scale = before + after > span - 4 ? Math.max(0, span - 4) / Math.max(1e-6, before + after) : 1
  return gappedBend(startPoint, endPoint, axis, before * scale, span - after * scale, {track: interpolate(p.track ?? 0, q.track ?? 0, mix)})
}

/**
 * A route with every join made tangent-continuous: at each join between
 * segments, the two handles are turned onto one line (their lengths kept), so
 * interpolated routes never show a kink.
 */
export function smoothJoins(route: Spline): Spline {
  const result = [...route]
  for (let index = 3; index + 1 < result.length; index += 3) {
    const joint = result[index]!,
      before = result[index - 1]!,
      after = result[index + 1]!
    const inLength = Math.hypot(joint.x - before.x, joint.y - before.y),
      outLength = Math.hypot(after.x - joint.x, after.y - joint.y)
    if (inLength < 1e-6 || outLength < 1e-6) continue
    // A join beside a stretch shorter than a unit has no meaningful tangent of its own: turning a long neighbour's
    // handle onto it would throw that neighbour out of shape.
    const chord = (from: number) => Math.hypot(result[from + 3]!.x - result[from]!.x, result[from + 3]!.y - result[from]!.y)
    if (chord(index - 3) < 1 || (index + 3 < result.length && chord(index) < 1)) continue
    const direction = {
      x: (joint.x - before.x) / inLength + (after.x - joint.x) / outLength,
      y: (joint.y - before.y) / inLength + (after.y - joint.y) / outLength,
    }
    const length = Math.hypot(direction.x, direction.y)
    if (length < 1e-6) continue
    const unit = {x: direction.x / length, y: direction.y / length}
    result[index - 1] = {x: joint.x - unit.x * inLength, y: joint.y - unit.y * inLength}
    result[index + 1] = {x: joint.x + unit.x * outLength, y: joint.y + unit.y * outLength}
  }
  return result
}

/**
 * Morphs two routes that both end with the arrowhead's straight lead-in: the
 * bodies morph by position along them and the lead-ins separately, so the
 * route still runs straight into its arrowhead in every frame.
 */
export function morphRoute(a: Spline, b: Spline, mix: number): Spline {
  const leadIn = (route: Spline) => {
    if (route.length < 7) return false
    const [p, c1, c2, q] = route.slice(-4) as [Point, Point, Point, Point]
    const length = Math.hypot(q.x - p.x, q.y - p.y)
    if (Math.abs(length - arrowHeadReach) > 0.01) return false
    const straight = (point: Point) => Math.abs((point.x - p.x) * (q.y - p.y) - (point.y - p.y) * (q.x - p.x)) / length < 0.01
    return straight(c1) && straight(c2)
  }
  if (!leadIn(a) || !leadIn(b)) return interpolateSpline(a, b, mix)
  const body = interpolateSpline(a.slice(0, -3), b.slice(0, -3), mix)
  const tail = a
    .slice(-3)
    .map((point, index) => ({x: interpolate(point.x, b.at(index - 3)!.x, mix), y: interpolate(point.y, b.at(index - 3)!.y, mix)}))
  return [...body, ...tail]
}

/** A redrawn route fades out on its old course, is absent mid-move, and fades in on its new one. */
export function redrawPresence(mix: number): number {
  return mix < 0.5 ? 1 - smoothstep(Math.min(1, mix / 0.35)) : smoothstep(Math.max(0, (mix - 0.65) / 0.35))
}

/** A straight route between the facing sides of two cards, for a relationship no layout placed. */
export function faceToFace(a: Point, aSize: {width: number; height: number}, b: Point, bSize: {width: number; height: number}): Spline {
  const exit = (center: Point, size: {width: number; height: number}, toward: Point): Point => {
    const dx = toward.x - center.x,
      dy = toward.y - center.y
    const scale = Math.min(Math.abs(size.width / 2 / dx) || Infinity, Math.abs(size.height / 2 / dy) || Infinity)
    return Number.isFinite(scale) ? {x: center.x + dx * scale, y: center.y + dy * scale} : center
  }
  return lineSpline(exit(a, aSize, b), exit(b, bSize, a))
}
