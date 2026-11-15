// How a route turns: its largest turn and its inflections.
import {sampleSpline} from '../splines.js'
import type {Spline} from '../splines.js'

/** Consecutive same-way turns of a route followed as fine samples, in radians (signed). */
function turnRuns(route: Spline): number[] {
  const points = sampleSpline(route, 1)
  const runs: number[] = []
  let previous: number | undefined
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!,
      b = points[index]!
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue
    const heading = Math.atan2(b.y - a.y, b.x - a.x)
    if (previous !== undefined) {
      let turn = heading - previous
      while (turn > Math.PI) turn -= 2 * Math.PI
      while (turn < -Math.PI) turn += 2 * Math.PI
      if (Math.abs(turn) > 1e-9) {
        if (runs.length && Math.sign(runs.at(-1)!) === Math.sign(turn)) runs[runs.length - 1]! += turn
        else runs.push(turn)
      }
    }
    previous = heading
  }
  return runs
}

/**
 * The largest turn a route makes one way without turning back, in degrees: 90
 * for an S of quarter circles, 180 for a hairpin or a cusp. A route between
 * facing sides never needs more than 90.
 */
export function largestTurn(route: Spline): number {
  return Math.max(0, ...turnRuns(route).map(run => (Math.abs(run) * 180) / Math.PI))
}

/**
 * How many times a route visibly changes the way it turns: the route is
 * followed as a polyline of fine samples, consecutive turns of one sign are
 * summed into runs, runs turning less than `threshold` degrees in all (the
 * imperceptible bends of a nearly straight stretch) are ignored, and the
 * count is how often the remaining runs change sign. One clean S has one.
 */
export function inflections(route: Spline, threshold = 3): number {
  const runs = turnRuns(route)
  const significant = runs.filter(run => Math.abs(run) >= (threshold * Math.PI) / 180)
  let count = 0
  for (let index = 1; index < significant.length; index++)
    if (Math.sign(significant[index]!) !== Math.sign(significant[index - 1]!)) count++
  return count
}
