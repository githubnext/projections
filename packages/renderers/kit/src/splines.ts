import {arrowHead, arrowHeadLength, arrowHeadReach} from './arrowhead.js'
import type {Point} from './edge-arrows.js'

/**
 * A relationship's route: a chain of cubic Bézier segments, `[start, c1, c2,
 * p1, c1, c2, p2, …]`, so its length is `3n + 1` for `n` segments. Routes
 * start on the source card's face and end on the target card's face.
 */
export type Spline = Point[]

const lerp = (a: Point, b: Point, t: number): Point => ({x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t})

/** A straight segment as one cubic, so every route is a uniform chain. */
export function lineSpline(from: Point, to: Point): Spline {
  return [from, lerp(from, to, 1 / 3), lerp(from, to, 2 / 3), to]
}

/** Joins two chains end to start, bridging any gap with a straight cubic. */
export function joinSplines(first: Spline, second: Spline): Spline {
  const end = first.at(-1)!,
    start = second[0]!
  const bridge = end.x === start.x && end.y === start.y ? [] : lineSpline(end, start).slice(1)
  return [...first, ...bridge, ...second.slice(1)]
}

/** The SVG path data of a chain. */
export function splinePath(points: Spline): string {
  const format = (point: Point) => `${Math.round(point.x * 100) / 100},${Math.round(point.y * 100) / 100}`
  let d = `M${format(points[0]!)}`
  for (let index = 1; index + 2 < points.length; index += 3) {
    d += ` C${format(points[index]!)} ${format(points[index + 1]!)} ${format(points[index + 2]!)}`
  }
  return d
}

/** The point at `t` on one segment `[p0, c1, c2, p1]`. */
export function cubicPoint(p0: Point, c1: Point, c2: Point, p1: Point, t: number): Point {
  const s = 1 - t
  return {
    x: s * s * s * p0.x + 3 * s * s * t * c1.x + 3 * s * t * t * c2.x + t * t * t * p1.x,
    y: s * s * s * p0.y + 3 * s * s * t * c1.y + 3 * s * t * t * c2.y + t * t * t * p1.y,
  }
}

/** Points along a chain, about `spacing` apart, for geometry checks. */
export function sampleSpline(points: Spline, spacing = 3): Point[] {
  const samples: Point[] = [points[0]!]
  for (let index = 0; index + 3 < points.length; index += 3) {
    const [p0, c1, c2, p1] = points.slice(index, index + 4) as [Point, Point, Point, Point]
    const length = Math.hypot(c1.x - p0.x, c1.y - p0.y) + Math.hypot(c2.x - c1.x, c2.y - c1.y) + Math.hypot(p1.x - c2.x, p1.y - c2.y)
    const count = Math.max(1, Math.ceil(length / spacing))
    for (let step = 1; step <= count; step++) samples.push(cubicPoint(p0, c1, c2, p1, step / count))
  }
  return samples
}

/** Splits the chain's longest segment at its middle (de Casteljau); the drawn curve is unchanged. */
function subdivide(points: Spline): Spline {
  let longest = 0,
    length = -1
  for (let index = 0; index + 3 < points.length; index += 3) {
    const span = Math.hypot(points[index + 3]!.x - points[index]!.x, points[index + 3]!.y - points[index]!.y)
    if (span > length) {
      length = span
      longest = index
    }
  }
  const [p0, c1, c2, p1] = points.slice(longest, longest + 4) as [Point, Point, Point, Point]
  const a = lerp(p0, c1, 0.5),
    b = lerp(c1, c2, 0.5),
    c = lerp(c2, p1, 0.5)
  const d = lerp(a, b, 0.5),
    e = lerp(b, c, 0.5),
    middle = lerp(d, e, 0.5)
  return [...points.slice(0, longest + 1), a, d, middle, e, c, ...points.slice(longest + 3)]
}

/** A chain with exactly `segments` segments drawing the same curve. */
export function withSegments(points: Spline, segments: number): Spline {
  let result = points
  while ((result.length - 1) / 3 < segments) result = subdivide(result)
  return result
}

/** Where each segment of a chain ends, as a fraction of the chain's length (the last is 1). */
function segmentEnds(points: Spline): number[] {
  const lengths: number[] = []
  for (let index = 0; index + 3 < points.length; index += 3) {
    const [p0, c1, c2, p1] = points.slice(index, index + 4) as [Point, Point, Point, Point]
    let length = 0,
      previous = p0
    for (let step = 1; step <= 8; step++) {
      const point = cubicPoint(p0, c1, c2, p1, step / 8)
      length += Math.hypot(point.x - previous.x, point.y - previous.y)
      previous = point
    }
    lengths.push(length)
  }
  const total = lengths.reduce((sum, length) => sum + length, 0)
  let running = 0
  return lengths.map((length, index) => {
    running += length
    return index === lengths.length - 1 ? 1 : total ? running / total : (index + 1) / lengths.length
  })
}

/** Fractions of a route's length closer than this are the same breakpoint. */
const cutTolerance = 1e-6

/** Splits a chain at the given fractions of its length (de Casteljau); the drawn curve is unchanged. */
function splitAt(points: Spline, ends: readonly number[], at: readonly number[]): Spline {
  const result: Spline = [points[0]!]
  let cut = 0
  for (let segment = 0; segment < ends.length; segment++) {
    const start = segment ? ends[segment - 1]! : 0,
      end = ends[segment]!
    const p1 = points[segment * 3 + 3]!
    let [p0, c1, c2] = points.slice(segment * 3, segment * 3 + 3) as [Point, Point, Point]
    let consumed = 0
    while (cut < at.length && at[cut]! < end - cutTolerance) {
      const fraction = at[cut++]!
      if (fraction <= start + cutTolerance) continue
      // The remaining piece covers [consumed, 1] of the segment's parameter; split it at the cut.
      const t = ((fraction - start) / (end - start) - consumed) / (1 - consumed)
      const a = lerp(p0, c1, t),
        b = lerp(c1, c2, t),
        c = lerp(c2, p1, t)
      const d = lerp(a, b, t),
        e = lerp(b, c, t)
      const f = lerp(d, e, t)
      result.push(a, d, f)
      ;[p0, c1, c2] = [f, e, c]
      consumed += (1 - consumed) * t
    }
    result.push(c1, c2, p1)
  }
  return result
}

const aligned = new WeakMap<Spline, WeakMap<Spline, [Spline, Spline]>>()

/**
 * Two chains split into the same number of segments that correspond by
 * position along each route: both are cut wherever either has a segment
 * boundary, measured as a fraction of its length. A corner of one route then
 * morphs into the matching stretch of the other, never into an unrelated leg.
 * Symmetric, so a reversed morph draws the same frames.
 */
function align(before: Spline, after: Spline): [Spline, Spline] {
  const cached = aligned.get(before)?.get(after)
  if (cached) return cached
  const a = segmentEnds(before),
    b = segmentEnds(after)
  const cuts = [...new Set([...a, ...b].slice().toSorted((x, y) => x - y))].filter(
    (fraction, index, all) => fraction < 1 - cutTolerance && (!index || fraction - all[index - 1]! > cutTolerance),
  )
  let result: [Spline, Spline] = [splitAt(before, a, cuts), splitAt(after, b, cuts)]
  // Breakpoints closer than the tolerance can leave the two a segment apart; subdivide evenly then.
  if (result[0].length !== result[1].length) {
    const segments = Math.max(before.length - 1, after.length - 1) / 3
    result = [withSegments(before, segments), withSegments(after, segments)]
  }
  if (!aligned.has(before)) aligned.set(before, new WeakMap())
  aligned.get(before)!.set(after, result)
  return result
}

/**
 * Morphs one route into another by interpolating control points, after
 * splitting both into segments that correspond by position along the route
 * (see `align`).
 */
export function interpolateSpline(before: Spline, after: Spline, progress: number): Spline {
  if (progress <= 0 || before === after) return before
  if (progress >= 1) return after
  const [a, b] = align(before, after)
  return a.map((point, index) => lerp(point, b[index]!, progress))
}

/**
 * Moves a chain with its endpoints: each control point follows the source
 * and target displacement in proportion to its place along the chain, so the
 * route stays attached while its cards move.
 */
export function followEndpoints(points: Spline, source: Point, target: Point): Spline {
  if (!source.x && !source.y && !target.x && !target.y) return points
  // Each point's share is its distance along the control polygon, so a short stretch moves almost as one and keeps
  // its direction. With more than one segment, the first and last (the tail stub and the arrowhead's lead-in) move
  // wholly with their cards, so they keep their length and direction.
  const distances = [0]
  for (let index = 1; index < points.length; index++) {
    distances.push(distances[index - 1]! + Math.hypot(points[index]!.x - points[index - 1]!.x, points[index]!.y - points[index - 1]!.y))
  }
  const ends = points.length >= 10
  const first = ends ? distances[3]! : 0,
    last = ends ? distances.at(-4)! : distances.at(-1)!
  const span = last - first || 1
  return points.map((point, index) => {
    const share = Math.max(0, Math.min(1, (distances[index]! - first) / span))
    return {x: point.x + source.x * (1 - share) + target.x * share, y: point.y + source.y * (1 - share) + target.y * share}
  })
}

/** A card's box, in the route's coordinates. */
export interface FaceBox {
  /** The box's left side. */
  x: number
  /** The box's top side. */
  y: number
  /** The box's width. */
  width: number
  /** The box's height. */
  height: number
}

/**
 * The inward normal of the face of `box` that `point` lies on (the nearest
 * face): down into a top face, right into a left face, and so on.
 */
export function inwardNormal(point: Point, box: FaceBox): Point {
  const faces: [number, Point][] = [
    [Math.abs(point.y - box.y), {x: 0, y: 1}],
    [Math.abs(point.y - (box.y + box.height)), {x: 0, y: -1}],
    [Math.abs(point.x - box.x), {x: 1, y: 0}],
    [Math.abs(point.x - (box.x + box.width)), {x: -1, y: 0}],
  ]
  return faces.reduce((best, face) => (face[0] < best[0] ? face : best))[1]
}

/**
 * Where a relationship's arrowhead goes and the shaft that leads to it. The
 * head's painted tip stops `outset` short of the target card's face the route
 * reaches (how far the card's border is painted outside its box, see
 * `cardBorderOutset`), so it touches the border without covering it, and points
 * along that face's inward normal, whatever the route's own final tangent is
 * (ELK ends spline sections with a degenerate cubic, whose tangent is
 * undefined). The shaft ends at the middle of the head's flat base, after a
 * straight lead-in collinear with the head (`arrowHeadReach` from the tip);
 * the route keeps its course up to the last point before that run and curves
 * into it smoothly, so the shaft never enters the head at an angle.
 */
export function arrowEnding(
  points: Spline,
  target: FaceBox,
  outset = 0,
): {shaft: Spline; tip: Point; direction: Point; base: Point; head: string} {
  const face = points.at(-1)!
  const normal = inwardNormal(face, target)
  const tip = {x: face.x - normal.x * outset, y: face.y - normal.y * outset}
  const head = arrowHead(tip, normal)
  const {direction, base, lead} = head
  // A route that already ends with a straight run along the head's axis, at least the lead-in long, keeps its
  // course: the shaft is cut at the base, so the route's own S runs into the head.
  if (points.length >= 7) {
    const [p, c1, c2] = points.slice(-4) as [Point, Point, Point]
    const run = (tip.x - p.x) * direction.x + (tip.y - p.y) * direction.y
    const offAxis = (point: Point) => Math.abs((point.x - tip.x) * direction.y - (point.y - tip.y) * direction.x)
    if (
      run + outset >= arrowHeadReach - 0.5 &&
      run > arrowHeadLength + 0.5 &&
      offAxis(p) < 0.25 &&
      offAxis(c1) < 0.25 &&
      offAxis(c2) < 0.25
    ) {
      // Snapped onto the axis exactly (a morph between two such tails can stray by a fraction of a unit).
      const onAxis = {x: tip.x - direction.x * run, y: tip.y - direction.y * run}
      const shaft = [...points.slice(0, -4), onAxis, ...lineSpline(onAxis, base).slice(1)]
      if (points.length > 4) {
        shaft[shaft.length - 5] = {x: shaft.at(-5)!.x + onAxis.x - p.x, y: shaft.at(-5)!.y + onAxis.y - p.y}
      }
      return {shaft, tip, direction, base, head: head.path}
    }
  }
  // How far a point lies past the start of the lead-in, along the head's axis.
  const past = (point: Point) => (point.x - lead.x) * direction.x + (point.y - lead.y) * direction.y
  let from = points.length - 4
  while (from > 0 && past(points[from]!) > -1) from -= 3
  const start = points[from]!
  if (from < 0 || past(start) > -1) return {shaft: lineSpline(start, base), tip, direction, base, head: head.path}
  // Leave `start` along the route's own tangent there, so the curve continues the course it was on.
  const unit = (origin: Point, toward: Point) => {
    const length = Math.hypot(toward.x - origin.x, toward.y - origin.y)
    return length > 1e-6 ? {x: (toward.x - origin.x) / length, y: (toward.y - origin.y) / length} : undefined
  }
  const tangent =
    (from > 0 ? (unit(points[from - 1]!, start) ?? unit(points[from - 3]!, start)) : unit(start, points[1]!)) ?? unit(start, lead)!
  const handle = Math.hypot(lead.x - start.x, lead.y - start.y) / 3
  const shaft = [
    ...points.slice(0, from + 1),
    {x: start.x + tangent.x * handle, y: start.y + tangent.y * handle},
    {x: lead.x - direction.x * handle, y: lead.y - direction.y * handle},
    lead,
    ...lineSpline(lead, base).slice(1),
  ]
  return {shaft, tip, direction, base, head: head.path}
}
