// Diff mode's static frame: the union layout with both revisions at full presence.
import type {Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import type {GraphLayout} from '../layout.js'
import type {GraphFrame, TransitionEdge, TransitionNode} from '../graph-transition.js'
import {faceToFace} from './morph.js'
import type {EdgeAlias, Ends} from './timing.js'

export function diffFrame(union: GraphLayout, entities: readonly EntityChange<Entity>[], edgeAliases: readonly EdgeAlias[]): GraphFrame {
  const nodes: TransitionNode[] = entities.map(row => {
    const point = union.points.get(row.id)!,
      size = union.sizes.get(row.id)!
    return {...row, ...point, width: size.width, height: size.height, group: union.groups.has(row.id), opacity: 1, local: 1}
  })
  const byId = new Map(nodes.map(node => [node.id, node]))
  const edges: TransitionEdge[] = []
  for (const {change, old, next, same} of edgeAliases) {
    const add = (edge: Ends | undefined, key: string, part?: 'before' | 'after') => {
      if (!edge || !byId.has(edge.from) || !byId.has(edge.to)) return
      const containment = union.groups.has(edge.from) && (change.before ?? change.after)?.kind === 'contains'
      const route = union.routes.get(key)
      const a = byId.get(edge.from)!,
        b = byId.get(edge.to)!
      edges.push({
        ...change,
        fromId: edge.from,
        toId: edge.to,
        opacity: 1,
        key,
        points: containment ? [] : (route ?? faceToFace(a, a, b, b)),
        containment,
        shared: union.shared.has(key),
        local: 1,
        ...(part ? {part} : {}),
      })
    }
    if (same) add(next ?? old, change.id)
    else {
      add(old, `${change.id}:before`, next ? 'before' : undefined)
      add(next, `${change.id}:after`, old ? 'after' : undefined)
    }
  }
  return {nodes, edges, junctions: [], width: union.width, height: union.height}
}
