// Where routes cross.
import type {Point} from '../edge-arrows.js'
import {sampleSpline} from '../splines.js'
import type {Spline} from '../splines.js'

/**
 * Where two routes cross: their sampled courses intersect anywhere but
 * within `ignore` of the given shared points (a common source port, or the
 * common target card they converge on).
 */
export function routeCrossings(a: Spline, b: Spline, ignore: readonly Point[] = [], radius = 3): Point[] {
  return polylineCrossings(samplesOf(a), samplesOf(b), ignore, radius)
}

// Routes are compared many times while routing settles; their samples are kept while they live (routes are never mutated).
const sampled = new WeakMap<Spline, Point[]>()
function samplesOf(route: Spline): Point[] {
  let value = sampled.get(route)
  if (!value) sampled.set(route, (value = sampleSpline(route, 3)))
  return value
}

/** Distance from `point` to the segment from `a` to `b`. */
function segmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t))
}

/** A sampled route's segments in runs of `chunk`, each with its bounds, and the bounds of the whole. */
interface Chunks {
  runs: Run[]
  /** The runs in groups of `group`, with the bounds of each group: long routes are mostly far from each other. */
  groups: {runs: Run[]; box: Box}[]
  box: Box
}
interface Run {
  from: number
  to: number
  box: Box
}
type Box = [left: number, right: number, top: number, bottom: number]
const chunk = 16
const group = 8
// Routes are tested against each other many times while routing settles: their chunks are kept while they live.
const chunked = new WeakMap<readonly Point[], Chunks>()

function chunksOf(points: readonly Point[]): Chunks {
  let value = chunked.get(points)
  if (value) return value
  const runs: Run[] = []
  const all: Box = [Infinity, -Infinity, Infinity, -Infinity]
  for (let from = 0; from + 1 < points.length; from += chunk) {
    const to = Math.min(points.length - 1, from + chunk)
    const box: Box = [Infinity, -Infinity, Infinity, -Infinity]
    for (let index = from; index <= to; index++) {
      const point = points[index]!
      if (point.x < box[0]) box[0] = point.x
      if (point.x > box[1]) box[1] = point.x
      if (point.y < box[2]) box[2] = point.y
      if (point.y > box[3]) box[3] = point.y
    }
    runs.push({from, to, box})
    all[0] = Math.min(all[0], box[0])
    all[1] = Math.max(all[1], box[1])
    all[2] = Math.min(all[2], box[2])
    all[3] = Math.max(all[3], box[3])
  }
  const groups: Chunks['groups'] = []
  for (let index = 0; index < runs.length; index += group) {
    const members = runs.slice(index, index + group)
    groups.push({
      runs: members,
      box: [
        Math.min(...members.map(run => run.box[0])),
        Math.max(...members.map(run => run.box[1])),
        Math.min(...members.map(run => run.box[2])),
        Math.max(...members.map(run => run.box[3])),
      ],
    })
  }
  value = {runs, groups, box: all}
  chunked.set(points, value)
  return value
}

const apart = (a: Box, b: Box) => a[1] < b[0] || b[1] < a[0] || a[3] < b[2] || b[3] < a[2]

/** Where two sampled routes (see `sampleSpline`) cross, as `routeCrossings`. */
export function polylineCrossings(pa: readonly Point[], pb: readonly Point[], ignore: readonly Point[] = [], radius = 3): Point[] {
  return crossingsBetween(pa, pb, ignore, radius, false)
}

/** Whether two sampled routes cross anywhere (see `polylineCrossings`), stopping at the first crossing. */
export function polylinesCross(pa: readonly Point[], pb: readonly Point[], ignore: readonly Point[] = [], radius = 3): boolean {
  return crossingsBetween(pa, pb, ignore, radius, true).length > 0
}

function crossingsBetween(pa: readonly Point[], pb: readonly Point[], ignore: readonly Point[], radius: number, first: boolean): Point[] {
  const ca = chunksOf(pa),
    cb = chunksOf(pb)
  const result: Point[] = []
  // Routes whose bounds don't meet never cross.
  if (!ca.runs.length || !cb.runs.length || apart(ca.box, cb.box)) return result
  // Routes from one point (a trunk) or into one point run together at first (or last): no crossing there.
  const together = (a: readonly Point[], b: readonly Point[], reversed: boolean) => {
    // Both walk the same course from the shared point, so the nearest of `b`'s samples only moves forward.
    const at = (list: readonly Point[], index: number) => list[reversed ? list.length - 1 - index : index]!
    const distance = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y)
    let count = 0,
      j = 0
    while (count < a.length) {
      const point = at(a, count)
      while (j + 1 < b.length && distance(at(b, j + 1), point) <= distance(at(b, j), point)) j++
      if (
        distance(at(b, j), point) >= 0.5 &&
        (j + 1 >= b.length || segmentDistance(point, at(b, j), at(b, j + 1)) >= 0.5) &&
        (j === 0 || segmentDistance(point, at(b, j - 1), at(b, j)) >= 0.5)
      )
        break
      count++
    }
    return count
  }
  const same = (p?: Point, q?: Point) => !!p && !!q && Math.hypot(p.x - q.x, p.y - q.y) < 0.5
  const [headA, headB] = same(pa[0], pb[0]) ? [together(pa, pb, false), together(pb, pa, false)] : [0, 0]
  const [tailA, tailB] = same(pa.at(-1), pb.at(-1)) ? [together(pa, pb, true), together(pb, pa, true)] : [0, 0]
  const shared = (list: readonly Point[], index: number, head: number, tail: number) => index < head || index + 1 >= list.length - tail
  const near = (point: Point) => ignore.some(at => Math.hypot(point.x - at.x, point.y - at.y) < radius)
  const cross = (o: Point, p: Point, q: Point) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x)
  // A group of `pa`'s runs is tested only against the groups of `pb` its bounds reach, a run only against their runs
  // its bounds reach, and each segment only against those its own bounds reach: the same pairs, in the same order, as
  // testing every segment against every run.
  for (const {runs, box: groupBox} of ca.groups) {
    if (apart(groupBox, cb.box)) continue
    const nearby = cb.groups.filter(other => !apart(groupBox, other.box))
    if (!nearby.length) continue
    for (const run of runs) {
      const reach = nearby.flatMap(other => other.runs.filter(candidate => !apart(run.box, candidate.box)))
      if (!reach.length) continue
      for (let i = run.from; i < run.to; i++) {
        if (shared(pa, i, headA, tailA)) continue
        const [a1, a2] = [pa[i]!, pa[i + 1]!]
        const ax0 = Math.min(a1.x, a2.x),
          ax1 = Math.max(a1.x, a2.x),
          ay0 = Math.min(a1.y, a2.y),
          ay1 = Math.max(a1.y, a2.y)
        if (ax1 < cb.box[0] || ax0 > cb.box[1] || ay1 < cb.box[2] || ay0 > cb.box[3]) continue
        if (near(a1) || near(a2)) continue
        for (const {from, to, box} of reach) {
          if (ax1 < box[0] || ax0 > box[1] || ay1 < box[2] || ay0 > box[3]) continue
          for (let j = from; j < to; j++) {
            if (shared(pb, j, headB, tailB)) continue
            const [b1, b2] = [pb[j]!, pb[j + 1]!]
            if (ax1 < Math.min(b1.x, b2.x) || Math.max(b1.x, b2.x) < ax0) continue
            if (ay1 < Math.min(b1.y, b2.y) || Math.max(b1.y, b2.y) < ay0) continue
            if (near(b1) || near(b2)) continue
            const d1 = cross(b1, b2, a1),
              d2 = cross(b1, b2, a2),
              d3 = cross(a1, a2, b1),
              d4 = cross(a1, a2, b2)
            // A proper crossing: each passes from one side of the other to the other. Routes that run together (a shared
            // trunk) or touch where they part are collinear there and never cross.
            const product = Math.hypot(a2.x - a1.x, a2.y - a1.y) * Math.hypot(b2.x - b1.x, b2.y - b1.y)
            if (
              d1 * d2 < 0 &&
              d3 * d4 < 0 &&
              Math.min(Math.abs(d1), Math.abs(d2), Math.abs(d3), Math.abs(d4)) > 1e-6 * Math.max(1, product)
            ) {
              const t = d1 / (d1 - d2)
              result.push({x: a1.x + (a2.x - a1.x) * t, y: a1.y + (a2.y - a1.y) * t})
              if (first) return result
            }
          }
        }
      }
    }
  }
  return result
}

/** Whether two routes cross (see `routeCrossings`). */
export function routesCross(a: Spline, b: Spline, ignore: readonly Point[] = [], radius = 3): boolean {
  return polylinesCross(samplesOf(a), samplesOf(b), ignore, radius)
}
