// Which boundaries draw changes inside them, so they stay neutral: change colors never nest.
import {classifyChange} from '../emphasis.js'
import type {TransitionEdge, TransitionNode} from '../graph-transition.js'

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

const boxOf = (node: TransitionNode): Box => ({
  left: node.x - node.width / 2,
  top: node.y - node.height / 2,
  right: node.x + node.width / 2,
  bottom: node.y + node.height / 2,
})
const inside = (inner: Box, outer: Box) =>
  inner.left >= outer.left && inner.top >= outer.top && inner.right <= outer.right && inner.bottom <= outer.bottom

/**
 * The IDs of the boundaries (group nodes) that have a changed card, boundary or relationship drawn inside them while
 * it is emphasized (`emphasis` above zero). Such a boundary is drawn neutral (`pk-holds-changes`): only the innermost
 * changes carry a change color.
 */
export function boundariesHoldingChanges(
  nodes: readonly TransitionNode[],
  edges: readonly TransitionEdge[],
  emphasis: (row: TransitionNode | TransitionEdge) => number,
): Set<string> {
  const changed = (row: TransitionNode | TransitionEdge) => classifyChange(row) !== 'unchanged' && emphasis(row) > 0.01
  const drawn: {row: TransitionNode | TransitionEdge; box: Box}[] = [
    ...nodes.filter(changed).map(node => ({row: node, box: boxOf(node)})),
    ...edges
      .filter(edge => edge.points.length > 0 && changed(edge))
      .map(edge => ({
        row: edge,
        box: {
          left: Math.min(...edge.points.map(point => point.x)),
          top: Math.min(...edge.points.map(point => point.y)),
          right: Math.max(...edge.points.map(point => point.x)),
          bottom: Math.max(...edge.points.map(point => point.y)),
        },
      })),
  ]
  const holding = new Set<string>()
  for (const group of nodes) {
    if (!group.group) continue
    const outer = boxOf(group)
    if (drawn.some(({row, box}) => row !== group && inside(box, outer))) holding.add(group.id)
  }
  return holding
}
