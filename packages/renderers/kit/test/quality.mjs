// Geometric quality measures for relationship routes (chains of cubic Béziers).

function derivatives(p0, p1, p2, p3, t) {
  const s = 1 - t
  return [
    {
      x: 3 * (s * s * (p1.x - p0.x) + 2 * s * t * (p2.x - p1.x) + t * t * (p3.x - p2.x)),
      y: 3 * (s * s * (p1.y - p0.y) + 2 * s * t * (p2.y - p1.y) + t * t * (p3.y - p2.y)),
    },
    {
      x: 6 * (s * (p2.x - 2 * p1.x + p0.x) + t * (p3.x - 2 * p2.x + p1.x)),
      y: 6 * (s * (p2.y - 2 * p1.y + p0.y) + t * (p3.y - 2 * p2.y + p1.y)),
    },
  ]
}

/** Signed curvature samples along the route, skipping degenerate points. */
export function curvatures(route, steps = 24) {
  const values = []
  for (let i = 0; i + 3 < route.length; i += 3) {
    const [p0, p1, p2, p3] = route.slice(i, i + 4)
    for (let k = 0; k <= steps; k++) {
      const [d1, d2] = derivatives(p0, p1, p2, p3, k / steps)
      const speed = Math.hypot(d1.x, d1.y)
      if (speed < 1e-3) continue
      values.push((d1.x * d2.y - d1.y * d2.x) / speed ** 3)
    }
  }
  return values
}

/** How many times the route visibly changes the way it turns (see the kit's `inflections`). */
export {inflections} from '../dist/index.js'

/** Tightest turn radius along the route. */
export function minimumRadius(route) {
  return Math.min(Infinity, ...curvatures(route).map(curvature => 1 / Math.abs(curvature)))
}

/** Largest change of direction at a join between segments, in degrees. */
export function largestKink(route) {
  let worst = 0
  const unit = (a, b) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y)
    return length < 1e-6 ? undefined : {x: (b.x - a.x) / length, y: (b.y - a.y) / length}
  }
  for (let i = 3; i + 1 < route.length; i += 3) {
    const before = unit(route[i - 1], route[i]) ?? unit(route[i - 2], route[i]) ?? unit(route[i - 3], route[i])
    const after = unit(route[i], route[i + 1]) ?? unit(route[i], route[i + 2]) ?? unit(route[i], route[i + 3])
    if (!before || !after) continue
    worst = Math.max(worst, (Math.acos(Math.max(-1, Math.min(1, before.x * after.x + before.y * after.y))) * 180) / Math.PI)
  }
  return worst
}

/** The largest turn a route makes one way without turning back, in degrees (see the kit's `largestTurn`). */
export {largestTurn} from '../dist/index.js'

/** Each straight segment of the route (control points on its chord) longer than half a unit, as its direction and length. */
export function straightSegments(route) {
  const result = []
  for (let i = 0; i + 3 < route.length; i += 3) {
    const [p0, p1, p2, p3] = route.slice(i, i + 4)
    const length = Math.hypot(p3.x - p0.x, p3.y - p0.y)
    if (length < 0.5) continue
    const off = point => Math.abs((point.x - p0.x) * (p3.y - p0.y) - (point.y - p0.y) * (p3.x - p0.x)) / length
    if (off(p1) > 0.01 || off(p2) > 0.01) continue
    result.push({from: p0, to: p3, length, direction: {x: (p3.x - p0.x) / length, y: (p3.y - p0.y) / length}})
  }
  return result
}

/**
 * Straight segments that are neither horizontal nor vertical (within 0.5°), and
 * visibly so: one that strays less than a tenth of a pixel off the axis (a
 * sliver of an S across a sub-pixel offset) draws as a straight line.
 */
export function diagonalStraights(route) {
  const tolerance = Math.sin((0.5 * Math.PI) / 180)
  return straightSegments(route).filter(
    ({direction, length}) =>
      Math.abs(direction.x) > tolerance &&
      Math.abs(direction.y) > tolerance &&
      length * Math.min(Math.abs(direction.x), Math.abs(direction.y)) >= 0.1,
  )
}

/**
 * The largest angle, in degrees, between the route's direction and `axis` (the
 * way it travels from source to target): at most 90 for a route that never
 * doubles back; a hairpin or cusp reaches 180.
 */
export function largestDeviation(route, axis) {
  let worst = 0
  for (let i = 0; i + 3 < route.length; i += 3) {
    const [p0, p1, p2, p3] = route.slice(i, i + 4)
    for (let k = 0; k <= 24; k++) {
      const [d] = derivatives(p0, p1, p2, p3, k / 24)
      const speed = Math.hypot(d.x, d.y)
      if (speed < 1e-3) continue
      const cos = (d.x * axis.x + d.y * axis.y) / speed
      worst = Math.max(worst, (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI)
    }
  }
  return worst
}

/**
 * Each stretch of a route as drafted: `straight` (with whether it is
 * axis-aligned) or `arc` (with its radius and turn in degrees, from its end
 * tangents and chord).
 */
export function stretches(route) {
  const result = []
  for (let i = 0; i + 3 < route.length; i += 3) {
    const [p0, p1, p2, p3] = route.slice(i, i + 4)
    const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y)
    if (chord < 1e-6) continue
    const off = point => Math.abs((point.x - p0.x) * (p3.y - p0.y) - (point.y - p0.y) * (p3.x - p0.x)) / chord
    if (off(p1) < 0.01 && off(p2) < 0.01) {
      result.push({kind: 'straight', from: p0, to: p3, aligned: Math.abs(p3.x - p0.x) < 0.01 || Math.abs(p3.y - p0.y) < 0.01})
      continue
    }
    const d0 = {x: p1.x - p0.x, y: p1.y - p0.y},
      d1 = {x: p3.x - p2.x, y: p3.y - p2.y}
    const turn = Math.acos(Math.max(-1, Math.min(1, (d0.x * d1.x + d0.y * d1.y) / (Math.hypot(d0.x, d0.y) * Math.hypot(d1.x, d1.y)))))
    result.push({kind: 'arc', from: p0, to: p3, radius: chord / (2 * Math.sin(turn / 2)), degrees: (turn * 180) / Math.PI})
  }
  return result
}

/**
 * How a route breaks the drafting rules: a straight stretch that isn't
 * axis-aligned, or an arc that isn't a quarter circle of `radius` (the
 * documented exception: a small-offset S, two equal shallower arcs of
 * `radius` meeting directly).
 */
export function draftingIssues(route, radius) {
  const issues = []
  const parts = stretches(route)
  for (const [index, part] of parts.entries()) {
    if (part.kind === 'straight') {
      if (!part.aligned) issues.push('diagonal straight')
      continue
    }
    if (Math.abs(part.radius - radius) > 0.5) issues.push(`arc radius ${part.radius.toFixed(1)}`)
    if (Math.abs(part.degrees - 90) < 0.5) continue
    // A small-offset S: this arc and a neighbour of the same turn, meeting directly.
    const paired = [parts[index - 1], parts[index + 1]].some(
      other => other?.kind === 'arc' && Math.abs(other.degrees - part.degrees) < 0.5 && Math.abs(other.radius - part.radius) < 0.5,
    )
    if (!paired) issues.push(`lone ${part.degrees.toFixed(1)}° arc`)
  }
  return issues
}

/**
 * Parallel runs of different routes closer than `spacing`: straight stretches
 * of one orientation overlapping by more than 2 units, except where routes
 * leaving one port run together (a trunk, within 0.75 units).
 */
export function crowdedRuns(routes, spacing) {
  const issues = []
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      const a = routes[i],
        b = routes[j]
      const trunk = Math.hypot(a.points[0].x - b.points[0].x, a.points[0].y - b.points[0].y) < 0.5
      for (const s of stretches(a.points).filter(part => part.kind === 'straight' && part.aligned)) {
        for (const t of stretches(b.points).filter(part => part.kind === 'straight' && part.aligned)) {
          const horizontal = part => Math.abs(part.to.y - part.from.y) < 0.01
          if (horizontal(s) !== horizontal(t)) continue
          const [along, across] = horizontal(s) ? ['x', 'y'] : ['y', 'x']
          const overlap =
            Math.min(Math.max(s.from[along], s.to[along]), Math.max(t.from[along], t.to[along])) -
            Math.max(Math.min(s.from[along], s.to[along]), Math.min(t.from[along], t.to[along]))
          const distance = Math.abs(s.from[across] - t.from[across])
          // Routes from one port within a fraction of a unit of each other are one trunk, drawn as one line.
          if (overlap <= 2 || (trunk && distance < 0.75)) continue
          if (distance < spacing - 0.01) issues.push(`${a.key} and ${b.key}: runs ${distance.toFixed(1)} apart`)
        }
      }
    }
  }
  return issues
}

/**
 * How the ports where routes meet one side of a card break the attachment
 * rules: `ports` are the routes' positions along that side (in the order of
 * where they come from) and `middle`, `length` the side's centre and length.
 * Ports are spread evenly (within 0.5) over a band centred on the side, at
 * most `spacing` apart and at least `inset` from its ends, in their order; a
 * lone port meets the centre.
 */
export function portIssues(ports, middle, length, spacing, inset) {
  const issues = []
  if (!ports.length) return issues
  const sorted = [...ports].toSorted((a, b) => a - b)
  if (ports.some((port, index) => port !== sorted[index])) issues.push('not in the order the routes come from')
  const mean = sorted.reduce((sum, port) => sum + port, 0) / sorted.length
  if (Math.abs(mean - middle) > 0.5) issues.push(`band off centre by ${(mean - middle).toFixed(1)}`)
  if (sorted.length > 1) {
    const steps = sorted.slice(1).map((port, index) => port - sorted[index])
    if (Math.max(...steps) - Math.min(...steps) > 0.5) issues.push(`uneven spacing ${steps.map(step => step.toFixed(1)).join(', ')}`)
    if (steps[0] > spacing + 0.5) issues.push(`spacing ${steps[0].toFixed(1)} over ${spacing}`)
    if (sorted[0] - (middle - length / 2) < inset - 0.5 || middle + length / 2 - sorted.at(-1) < inset - 0.5) {
      issues.push('port too near a corner')
    }
  }
  return issues
}
