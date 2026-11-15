// The graph ELK lays out: cards in a stable order, positional IDs, and relationships split at shared junctions.
import type {ElkExtendedEdge} from 'elkjs/lib/elk-api.js'
import type {Point} from '../edge-arrows.js'
import {compareIds} from './model.js'
import type {LayoutEdge, GraphLayoutOptions, LayoutNode} from './model.js'
import {boundaryKinds, moduleGroups} from './groups.js'
import {sharedStages} from './shared-stages.js'
import type {SharedStage} from './shared-stages.js'

export interface ElkInput {
  nodes: readonly LayoutNode[]
  direction: 'DOWN' | 'RIGHT'
  /** The coordinate across the layers. */
  across: 'x' | 'y'
  /** Compound boundaries and their children. */
  groups: Map<string, string[]>
  /** Each child's boundary. */
  member: Map<string, string>
  hints: ReadonlyMap<string, Point>
  /** Relationships placed, in an order independent of their IDs. */
  placed: LayoutEdge[]
  stages: SharedStage[]
  /** Relationships through a junction, and its stage. */
  viaJunction: Map<string, number>
  /** Every node, in hinted order. */
  ordered: LayoutNode[]
  /** Cards with no relationships, placed in the room the rest leaves (see `placeUnlinked`). */
  unlinked: Set<string>
  /** Nodes ELK lays out. */
  laid: LayoutNode[]
  elkId: Map<string, string>
  byElk: Map<string, string>
  elkEdges: ElkExtendedEdge[]
  /** ELK edges of each relationship: one, or two through a junction. */
  parts: Map<string, string[]>
}

export function elkInput(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[], options: GraphLayoutOptions): ElkInput {
  const direction = options.orientation === 'horizontal' ? 'RIGHT' : 'DOWN'
  const kinds = boundaryKinds(options.compound)
  const groups = kinds.length ? moduleGroups(nodes, edges, kinds, options.boundaries) : new Map<string, string[]>()
  const hints = options.hints ?? new Map<string, Point>()
  const across = direction === 'DOWN' ? 'x' : 'y'
  const byOrder = (a: string, b: string) => (hints.get(a)?.[across] ?? Infinity) - (hints.get(b)?.[across] ?? Infinity) || compareIds(a, b)
  const present = new Set(nodes.map(node => node.id))
  const placed = edges
    .filter(edge => present.has(edge.from) && present.has(edge.to) && !(edge.kind === 'contains' && groups.has(edge.from)))
    // Independent of edge IDs, which differ between a comparison and its mirror.
    .sort((a, b) => byOrder(a.from, b.from) || byOrder(a.to, b.to) || compareIds(a.kind, b.kind) || compareIds(a.id, b.id))
  const stages = options.junctions ? sharedStages(placed) : []
  const viaJunction = new Map(stages.flatMap((stage, index) => stage.edges.map(edge => [edge.id, index])))

  // ELK IDs are positions, so geometry never depends on identifier text.
  const member = new Map<string, string>()
  for (const [group, children] of groups) for (const child of children) member.set(child, group)
  const ordered = [...nodes].sort((a, b) => byOrder(a.id, b.id))
  // Cards with no relationships take places on the rest's layers after ELK lays it out, or a grid of their own when
  // there is no rest (see `placeUnlinked`).
  const linked = new Set(placed.flatMap(edge => [edge.from, edge.to]))
  const unlinked = new Set(
    ordered.filter(node => !groups.has(node.id) && !member.has(node.id) && !linked.has(node.id)).map(node => node.id),
  )
  const laid = ordered.filter(node => !unlinked.has(node.id))
  const elkId = new Map(laid.map((node, index) => [node.id, `n${index}`]))
  const elkEdges: ElkExtendedEdge[] = []
  const add = (source: string, target: string) => {
    const id = `e${elkEdges.length}`
    elkEdges.push({id, sources: [source], targets: [target]})
    return id
  }
  const parts = new Map<string, string[]>()
  for (const [index, stage] of stages.entries()) {
    for (const source of stage.sources) parts.set(`j${index}<${source}`, [add(elkId.get(source)!, `j${index}`)])
    for (const target of stage.targets) parts.set(`j${index}>${target}`, [add(`j${index}`, elkId.get(target)!)])
  }
  for (const edge of placed) {
    const stage = viaJunction.get(edge.id)
    parts.set(
      edge.id,
      stage === undefined
        ? [add(elkId.get(edge.from)!, elkId.get(edge.to)!)]
        : [...parts.get(`j${stage}<${edge.from}`)!, ...parts.get(`j${stage}>${edge.to}`)!],
    )
  }

  const byElk = new Map([...elkId].map(([id, elk]) => [elk, id]))
  return {
    nodes,
    direction,
    across,
    groups,
    member,
    hints,
    placed,
    stages,
    viaJunction,
    ordered,
    unlinked,
    laid,
    elkId,
    byElk,
    elkEdges,
    parts,
  }
}
