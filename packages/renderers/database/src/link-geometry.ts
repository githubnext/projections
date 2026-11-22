import {
  arrowHead,
  arrowHeadReach,
  joinSplines,
  lineSpline,
  routeTail,
  sBend,
  splinePath,
  type Spline,
} from '@githubnext/projections-renderer-kit'
import type {FrameLink} from './frame.js'

/**
 * The kit's arrowhead where a link reaches its principal column: links enter
 * a table's side horizontally, moving right into a left side and left into a
 * right side. Its painted tip stops `outset` outside the side, on the outer
 * edge of the table's border, touching it without covering it: none for the
 * view's tables, whose edges (an outline, restyled by rings) are inside them.
 */
export function linkHead(link: FrameLink, outset = 0) {
  const direction = {x: link.sides[1] === 'left' ? 1 : -1, y: 0}
  const end = link.points.at(-1)!
  return arrowHead({x: end.x - direction.x * outset, y: end.y}, direction)
}

/**
 * The widest a link turns: the room between ranks (`schemaMetrics.rankGap`) keeps a gap's S turns to about 22, and a
 * gutter lane's corners take up to this. Wider than the graphs' `routeRadius`, which keeps their layers close.
 */
export const linkRadius = 28

/**
 * A link's route as the kit draws every relationship: between ranks, one S
 * (stubs perpendicular to the tables' sides, quarter-circle turns and a
 * vertical run, see `sBend`) per gap, straight through a rank it crosses; in a
 * gutter lane or a loop back to its own table, quarter-circle corners. Either
 * way it ends with a straight lead-in along the arrowhead's axis.
 */
export function linkRoute(link: FrameLink): Spline {
  const points = link.points
  const end = points.at(-1)!
  const into = {x: link.sides[1] === 'left' ? 1 : -1, y: 0}
  if (link.shape === 'orthogonal') {
    // Leaves its side, runs along a lane and comes back: each corner as round as its two legs allow, the last one ending
    // before the lead-in and the first after a short tail.
    const lead = {x: end.x - into.x * arrowHeadReach, y: end.y}
    const corners = points.slice(1, -1)
    const legs = [points[0]!, ...corners, lead].slice(0, -1).map((point, index, list) => {
      const next = index + 1 < list.length ? list[index + 1]! : lead
      return Math.hypot(next.x - point.x, next.y - point.y)
    })
    let route: Spline = [points[0]!]
    let cursor = points[0]!
    corners.forEach((corner, index) => {
      const before = index === 0 ? points[0]! : corners[index - 1]!,
        after = index === corners.length - 1 ? lead : corners[index + 1]!
      const radius = Math.max(
        0,
        Math.min(
          linkRadius,
          index === 0 ? legs[0]! - routeTail : legs[index]! / 2,
          index === corners.length - 1 ? legs[index + 1]! : legs[index + 1]! / 2,
        ),
      )
      const toward = (from: {x: number; y: number}, distance: number) => {
        const length = Math.hypot(from.x - corner.x, from.y - corner.y) || 1
        return {x: corner.x + ((from.x - corner.x) / length) * distance, y: corner.y + ((from.y - corner.y) / length) * distance}
      }
      const enter = toward(before, radius),
        leave = toward(after, radius)
      if (Math.hypot(enter.x - cursor.x, enter.y - cursor.y) > 0.01) route = joinSplines(route, lineSpline(cursor, enter))
      // A quarter circle's cubic handles are 0.5523 of its radius.
      const k = 0.5523
      route = joinSplines(route, [
        enter,
        {x: enter.x + (corner.x - enter.x) * k, y: enter.y + (corner.y - enter.y) * k},
        {x: leave.x + (corner.x - leave.x) * k, y: leave.y + (corner.y - leave.y) * k},
        leave,
      ])
      cursor = leave
    })
    if (Math.hypot(lead.x - cursor.x, lead.y - cursor.y) > 0.01) route = joinSplines(route, lineSpline(cursor, lead))
    return joinSplines(route, lineSpline(lead, end))
  }
  const axis = {x: link.sides[0] === 'left' ? -1 : 1, y: 0}
  let route: Spline = [points[0]!]
  for (let index = 0; index + 1 < points.length; index += 2) {
    const from = points[index]!,
      to = points[index + 1]!
    const last = index + 2 === points.length
    if (index > 0) route = joinSplines(route, lineSpline(route.at(-1)!, from))
    route = joinSplines(
      route,
      sBend(from, to, axis, {lead: last, track: link.tracks[index / 2] ?? 0, radius: linkRadius}) ?? lineSpline(from, to),
    )
  }
  return route
}

/** A link's shaft: its route, cut at the middle of its arrowhead's base, after the straight lead-in. */
export function linkPath(link: FrameLink, outset = 0): string {
  if (!link.points.length) return ''
  const route = linkRoute(link)
  const head = linkHead(link, outset)
  return splinePath(joinSplines(route.slice(0, -3), lineSpline(route.at(-4)!, head.base)))
}
