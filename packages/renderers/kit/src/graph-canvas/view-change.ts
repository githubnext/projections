// A change of view of the same document (a group expanded or collapsed): the cards move from where they were to
// where the new layout puts them, while what only one view draws fades.
import type {Point} from '../edge-arrows.js'
import type {GraphFrame, TransitionEdge, TransitionNode} from '../graph-transition.js'
import {interpolate, morphRoute} from '../graph-transition/morph.js'
import {smoothstep} from '../motion.js'

/** How long the cards take to move to the new view, ms. */
export const viewChangeMs = 420

/** A frame moved by `offset`, in layout units. */
export function shiftFrame(frame: GraphFrame, offset: Point): GraphFrame {
  if (!offset.x && !offset.y) return frame
  const move = <T extends Point>(point: T): T => ({...point, x: point.x + offset.x, y: point.y + offset.y})
  return {
    ...frame,
    nodes: frame.nodes.map(move),
    edges: frame.edges.map(edge => ({...edge, points: edge.points.map(move)})),
    junctions: frame.junctions.map(move),
  }
}

const within = (mix: number, start: number, end: number) => smoothstep(Math.min(1, Math.max(0, (mix - start) / (end - start))))

/**
 * The frame `mix` (0 to 1, eased) of the way from `from` to `to`: a card in both moves and resizes, one only `to` draws
 * fades in over the second half, and one only `from` draws fades out over the first, where it was. A relationship in
 * both morphs its route with its cards; the others fade with the cards that bring or take them.
 */
export function morphFrames(from: GraphFrame, to: GraphFrame, mix: number): GraphFrame {
  if (mix >= 1) return to
  const before = new Map(from.nodes.map(node => [node.id, node]))
  const after = new Set(to.nodes.map(node => node.id))
  const arriving = within(mix, 0.45, 1),
    leaving = 1 - within(mix, 0, 0.45)
  const nodes: TransitionNode[] = [
    ...to.nodes.map(node => {
      const was = before.get(node.id)
      if (!was) return {...node, opacity: node.opacity * arriving}
      return {
        ...node,
        x: interpolate(was.x, node.x, mix),
        y: interpolate(was.y, node.y, mix),
        width: interpolate(was.width, node.width, mix),
        height: interpolate(was.height, node.height, mix),
        opacity: interpolate(was.opacity, node.opacity, mix),
      }
    }),
    ...from.nodes.filter(node => !after.has(node.id)).map(node => ({...node, opacity: node.opacity * leaving})),
  ].filter(node => node.opacity > 0.001)
  const drawn = new Set(nodes.map(node => node.id))
  const edgesBefore = new Map(from.edges.map(edge => [edge.key, edge]))
  const edgesAfter = new Set(to.edges.map(edge => edge.key))
  const edges: TransitionEdge[] = [
    ...to.edges.map(edge => {
      const was = edgesBefore.get(edge.key)
      return was && was.points.length && edge.points.length
        ? {...edge, points: morphRoute(was.points, edge.points, mix), opacity: interpolate(was.opacity, edge.opacity, mix)}
        : {...edge, opacity: edge.opacity * within(mix, 0.6, 1)}
    }),
    ...from.edges.filter(edge => !edgesAfter.has(edge.key)).map(edge => ({...edge, opacity: edge.opacity * within(1 - mix, 0.6, 1)})),
  ].filter(edge => edge.opacity > 0.001 && drawn.has(edge.fromId) && drawn.has(edge.toId))
  return {nodes, edges, junctions: [], width: to.width, height: to.height}
}
