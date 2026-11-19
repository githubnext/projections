// What a graph's opening view frames when the host asks for a focus (see `RendererFocus`), or diff mode opens on its
// changes: their bounds, from every layout the transition passes through.
import type {RendererFocus} from '@githubnext/projections-renderer-sdk/protocol'
import {isChanged} from '../emphasis.js'
import type {GraphFrame, GraphTransition} from '../graph-transition.js'
import type {ComparisonModel} from '../model.js'
import type {ContentBox} from '../zoom.js'

/** Room around a focused item (its strokes, rings and arrowheads), in content units. */
const margin = 24

/**
 * What an opening view frames: its bounds, the boxes of the cards in it (for its reading start), and every card the
 * graph draws (so the view's edges can fall between cards rather than through them).
 */
export interface FocusArea {
  box: ContentBox
  cards: ContentBox[]
  drawn: ContentBox[]
}

/**
 * The area a focus request frames in a laid-out graph: the item it names with the cards it connects to, or every
 * changed card and relationship (with the cards at their ends) that this graph draws, and in the Changes scope
 * (`shown`) the cards that give them context; undefined for everything (`all`, or nothing it names is drawn). Without
 * a request, diff mode frames the changes; other modes everything.
 */
export function focusArea(
  transition: GraphTransition,
  diff: boolean,
  model: ComparisonModel,
  request: RendererFocus | undefined,
  shown?: ReadonlySet<string>,
): FocusArea | undefined {
  if (request?.id === undefined && (request?.on === 'all' || (!request && !diff) || model.mode !== 'comparison')) return undefined
  const frames: GraphFrame[] = diff ? [transition.diff] : [transition(0), transition(1)]
  const nodes = new Map(frames.flatMap(frame => frame.nodes.filter(node => !node.group).map(node => [node.id, node] as const)))
  const edges = frames.flatMap(frame => frame.edges.filter(edge => !edge.containment))
  const wanted = new Set<string>()
  if (request?.id !== undefined) {
    wanted.add(request.id)
    for (const edge of edges)
      if (edge.id === request.id || edge.fromId === request.id || edge.toId === request.id) wanted.add(edge.fromId).add(edge.toId)
  } else for (const row of model.entities) if (isChanged(row) || shown?.has(row.id)) wanted.add(row.id)
  const routes = edges.filter(edge => (request?.id === undefined ? isChanged(edge) : edge.id === request.id))
  for (const edge of routes) wanted.add(edge.fromId).add(edge.toId)
  const boxOf = (node: {x: number; y: number; width: number; height: number}) => ({
    x: node.x - node.width / 2,
    y: node.y - node.height / 2,
    width: node.width,
    height: node.height,
  })
  const cards = [...wanted].flatMap(id => {
    const node = nodes.get(id)
    return node ? [boxOf(node)] : []
  })
  if (!cards.length) return undefined
  const xs = [...cards.flatMap(card => [card.x, card.x + card.width]), ...routes.flatMap(edge => edge.points.map(point => point.x))]
  const ys = [...cards.flatMap(card => [card.y, card.y + card.height]), ...routes.flatMap(edge => edge.points.map(point => point.y))]
  const left = Math.min(...xs) - margin,
    top = Math.min(...ys) - margin
  const drawn = [...nodes.values()].map(boxOf)
  return {box: {x: left, y: top, width: Math.max(...xs) + margin - left, height: Math.max(...ys) + margin - top}, cards, drawn}
}
