// An orthogonal course as a flowing curve through its longest legs.
import {arrowHeadLength, arrowHeadReach} from '../arrowhead.js'
import type {ArrowBox, Point} from '../edge-arrows.js'
import {contains} from './boxes.js'

export function flowingRoute(
  points: Point[],
  base: Point,
  startDirection: Point,
  endDirection: Point,
  obstacles: ArrowBox[],
): string | undefined {
  const unique = points.filter((point, index) => index === 0 || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y)
  const corners = unique.filter((point, index) => {
    if (index === 0 || index === unique.length - 1) return true
    const before = unique[index - 1]!,
      after = unique[index + 1]!
    return (point.x - before.x) * (after.y - point.y) !== (point.y - before.y) * (after.x - point.x)
  })
  if (corners.length < 4) return undefined
  const lanes = Array.from({length: corners.length - 3}, (_, offset) => {
    const index = offset + 1
    const from = corners[index]!,
      to = corners[index + 1]!
    const length = Math.hypot(to.x - from.x, to.y - from.y)
    return {
      index,
      length,
      middle: {x: (from.x + to.x) / 2, y: (from.y + to.y) / 2},
      direction: {x: (to.x - from.x) / length, y: (to.y - from.y) / length},
    }
  })
    .toSorted((a, b) => b.length - a.length)
    .slice(0, 4)

  const curveThrough = (chosen: typeof lanes): string | undefined => {
    const ordered = chosen.toSorted((a, b) => a.index - b.index)
    // The curve ends where the arrowhead's lead-in begins; the lead-in runs straight on to the base.
    const lead = {
      x: base.x + endDirection.x * (arrowHeadReach - arrowHeadLength),
      y: base.y + endDirection.y * (arrowHeadReach - arrowHeadLength),
    }
    const waypoints = [points[0]!, ...ordered.map(lane => lane.middle), lead]
    const tangents = [startDirection, ...ordered.map(lane => lane.direction), {x: -endDirection.x, y: -endDirection.y}]
    const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y)
    const handles = waypoints.map((point, index) => {
      if (index === 0) return Math.min(64, distance(point, waypoints[1]!) * 0.45)
      if (index === waypoints.length - 1) return Math.min(64, distance(waypoints[index - 1]!, point) * 0.45)
      return Math.min(
        90,
        ordered[index - 1]!.length / 2 + 12,
        distance(waypoints[index - 1]!, point) * 0.7,
        distance(point, waypoints[index + 1]!) * 0.7,
      )
    })
    const path = [`M${waypoints[0]!.x},${waypoints[0]!.y}`]
    for (let index = 0; index < waypoints.length - 1; index++) {
      const start = waypoints[index]!,
        end = waypoints[index + 1]!
      const departing = tangents[index]!,
        arriving = tangents[index + 1]!
      const control1 = {x: start.x + departing.x * handles[index]!, y: start.y + departing.y * handles[index]!}
      const control2 = {x: end.x - arriving.x * handles[index + 1]!, y: end.y - arriving.y * handles[index + 1]!}
      const count = Math.max(1, Math.ceil((distance(start, control1) + distance(control1, control2) + distance(control2, end)) / 4))
      for (let step = 0; step <= count; step++) {
        const t = step / count,
          s = 1 - t
        if (
          obstacles.some(box =>
            contains(
              box,
              {
                x: s ** 3 * start.x + 3 * s ** 2 * t * control1.x + 3 * s * t ** 2 * control2.x + t ** 3 * end.x,
                y: s ** 3 * start.y + 3 * s ** 2 * t * control1.y + 3 * s * t ** 2 * control2.y + t ** 3 * end.y,
              },
              2,
            ),
          )
        ) {
          return undefined
        }
      }
      path.push(`C${control1.x},${control1.y} ${control2.x},${control2.y} ${end.x},${end.y}`)
    }
    path.push(`L${base.x},${base.y}`)
    return path.join(' ')
  }
  for (const lane of lanes) {
    const curve = curveThrough([lane])
    if (curve) return curve
  }
  for (let index = 0; index < lanes.length; index++) {
    for (let next = index + 1; next < lanes.length; next++) {
      const curve = curveThrough([lanes[index]!, lanes[next]!])
      if (curve) return curve
    }
  }
  return undefined
}
