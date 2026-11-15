// Cards' boxes and relationships as drawn at their current presence.
import {cardBorderOutset} from '../border.js'
import type {ArrowBox, Point} from '../edge-arrows.js'
import type {TransitionEdge, TransitionNode} from '../graph-transition.js'
import {arrowEnding, splinePath} from '../splines.js'

/** A card's box at its current presence: entering and leaving cards scale from 90%. */
export function cardBox(node: Pick<TransitionNode, 'x' | 'y' | 'width' | 'height' | 'opacity'>): ArrowBox {
  const scale = 0.9 + node.opacity * 0.1
  return {
    x: node.x - (node.width / 2) * scale,
    y: node.y - (node.height / 2) * scale,
    width: node.width * scale,
    height: node.height * scale,
  }
}

/**
 * A relationship as drawn: its route with each end on its card's face at the
 * card's current scale, and the kit's arrowhead (see `arrowHead`) with its tip
 * on the target card's face, the shaft running straight into the middle of
 * its base.
 */
export function drawnEdge(
  edge: Pick<TransitionEdge, 'points'>,
  from: TransitionNode,
  to: TransitionNode,
  outset = cardBorderOutset(),
): {d: string; tip: Point; base: Point; head: string; direction: Point} {
  const points = [...edge.points]
  // Entering and leaving cards scale about their centre; the route's ends (and their tangents) follow the faces.
  // The arrowhead's straight lead-in (the last segment) and the handle before it move together, so the run stays straight.
  const follow = (index: number, moved: readonly number[], node: TransitionNode) => {
    const scale = 0.9 + node.opacity * 0.1,
      point = points[index]!
    const shift = {x: (node.x - point.x) * (1 - scale), y: (node.y - point.y) * (1 - scale)}
    for (const at of moved) points[at] = {x: points[at]!.x + shift.x, y: points[at]!.y + shift.y}
  }
  const last = points.length - 1
  follow(0, [0, 1], from)
  follow(last, last >= 5 ? [last, last - 1, last - 2, last - 3, last - 4] : [last, last - 1], to)
  const {shaft, tip, base, head, direction} = arrowEnding(points, cardBox(to), outset)
  return {d: splinePath(shaft), tip, base, head, direction}
}
