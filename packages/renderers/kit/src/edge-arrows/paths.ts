// An orthogonal course drawn with rounded corners, and a curve finished straight into its arrowhead.
import {arrowHeadLength as edgeArrowHeadLength, arrowHeadReach} from '../arrowhead.js'
import type {Point} from '../edge-arrows.js'

export function roundedRoute(points: Point[], end: Point, maxRadius = 36): string {
  points = points.filter((point, index) => !index || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y)
  points = points.filter((point, index) => {
    if (!index || index === points.length - 1) return true
    const before = points[index - 1]!,
      after = points[index + 1]!
    return (point.x - before.x) * (after.y - point.y) !== (point.y - before.y) * (after.x - point.x)
  })
  const path = [`M${points[0]!.x},${points[0]!.y}`]
  for (let index = 1; index < points.length - 1; index++) {
    const before = points[index - 1]!,
      corner = points[index]!,
      after = points[index + 1]!
    const inLength = Math.hypot(corner.x - before.x, corner.y - before.y)
    const outLength = Math.hypot(after.x - corner.x, after.y - corner.y)
    if (!inLength || !outLength) continue
    if ((corner.x - before.x) * (after.y - corner.y) === (corner.y - before.y) * (after.x - corner.x)) continue
    const radius = Math.min(maxRadius, inLength / 2, outLength / 2)
    const incoming = {x: (corner.x - before.x) / inLength, y: (corner.y - before.y) / inLength}
    const outgoing = {x: (after.x - corner.x) / outLength, y: (after.y - corner.y) / outLength}
    const entry = {x: corner.x - incoming.x * radius, y: corner.y - incoming.y * radius}
    const exit = {x: corner.x + outgoing.x * radius, y: corner.y + outgoing.y * radius}
    const handle = radius * 0.55228475
    path.push(`L${entry.x},${entry.y}`)
    path.push(
      `C${entry.x + incoming.x * handle},${entry.y + incoming.y * handle} ${exit.x - outgoing.x * handle},${exit.y - outgoing.y * handle} ${exit.x},${exit.y}`,
    )
  }
  path.push(`L${end.x},${end.y}`)
  return path.join(' ')
}

/** A curve from `start` that runs straight into the arrowhead's base for its lead-in, along the curve's arriving direction. */
export function finishArrow(start: Point, control1: Point, control2: Point, end: Point) {
  const dx = end.x - control2.x
  const dy = end.y - control2.y
  const length = Math.hypot(dx, dy)
  const direction = {x: dx / length, y: dy / length}
  const base = {x: end.x - direction.x * edgeArrowHeadLength, y: end.y - direction.y * edgeArrowHeadLength}
  const lead = {x: end.x - direction.x * arrowHeadReach, y: end.y - direction.y * arrowHeadReach}
  const handle = Math.max(8, length - arrowHeadReach)
  const arriving = {x: lead.x - direction.x * handle, y: lead.y - direction.y * handle}
  return {
    d: `M${start.x},${start.y} C${control1.x},${control1.y} ${arriving.x},${arriving.y} ${lead.x},${lead.y} L${base.x},${base.y}`,
    start,
    base,
    end,
  }
}
