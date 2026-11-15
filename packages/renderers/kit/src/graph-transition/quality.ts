// How far a morphed route strays from a drafted one: kinks at its joins and slanted straight runs.
import type {Point} from '../edge-arrows.js'
import type {Spline} from '../splines.js'

/** The largest change of direction at a join between a route's stretches, in degrees (0 for a smooth route). */
export function largestKink(route: Spline): number {
  const unit = (from: Point, to: Point) => {
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    return length < 1e-6 ? undefined : {x: (to.x - from.x) / length, y: (to.y - from.y) / length}
  }
  let worst = 0
  for (let index = 3; index + 1 < route.length; index += 3) {
    const joint = route[index]!
    const before = unit(route[index - 1]!, joint) ?? unit(route[index - 2]!, joint) ?? unit(route[index - 3]!, joint)
    const after = unit(joint, route[index + 1]!) ?? unit(joint, route[index + 2]!) ?? unit(joint, route[index + 3]!)
    if (!before || !after) continue
    worst = Math.max(worst, (Math.acos(Math.max(-1, Math.min(1, before.x * after.x + before.y * after.y))) * 180) / Math.PI)
  }
  return worst
}

/**
 * The longest straight stretch that is neither along nor across the axis (by more than 3°): a drafted route has
 * none, but a morph between two differently shaped routes can slant one of their runs.
 */
export function longestDiagonal(route: Spline): number {
  const slant = Math.sin((3 * Math.PI) / 180)
  let worst = 0
  for (let index = 0; index + 3 < route.length; index += 3) {
    const [p0, p1, p2, p3] = [route[index]!, route[index + 1]!, route[index + 2]!, route[index + 3]!]
    const length = Math.hypot(p3.x - p0.x, p3.y - p0.y)
    if (length < 0.5) continue
    const off = (point: Point) => Math.abs((point.x - p0.x) * (p3.y - p0.y) - (point.y - p0.y) * (p3.x - p0.x)) / length
    if (off(p1) > 0.5 || off(p2) > 0.5) continue
    const dx = Math.abs(p3.x - p0.x) / length,
      dy = Math.abs(p3.y - p0.y) / length
    if (dx > slant && dy > slant) worst = Math.max(worst, length)
  }
  return worst
}
