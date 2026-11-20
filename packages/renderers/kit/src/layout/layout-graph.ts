// Lays out a graph with ELK: groups, places, routes and fits it, with recent layouts reused.
import type {LayoutEdge, GraphLayout, GraphLayoutOptions, LayoutNode} from './model.js'
import {boundaryKinds} from './groups.js'
import {layerGap, layerGapAttempts, layerGapGrowth} from './placement.js'
import {layOut} from './lay-out.js'

/** Above this many cards, a graph with boundaries grows its layer gap only once (see `layOutFitting`). */
const compoundGrowthLimit = 80

// Recent layouts by input: a new step order or direction reuses them instead of laying out again.
const recent = new Map<string, Promise<GraphLayout>>()
const recentLimit = 24

/**
 * Lays out a graph with ELK's layered algorithm: cards in layers (top to
 * bottom, or left to right for `horizontal`), relationships as splines that
 * leave and enter the cards' faces across the layers, containment-only
 * modules as compound boundaries. Browsers run ELK in a Worker. Layouts are
 * shared, never mutated: callers must not change the result.
 */
export function layoutGraph(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  options: GraphLayoutOptions = {},
): Promise<GraphLayout> {
  const key = JSON.stringify([
    nodes.map(node => [node.id, node.kind, node.height, node.width]),
    edges.map(edge => [edge.id, edge.from, edge.to, edge.kind]),
    options.orientation,
    options.compound,
    options.boundaries && [...options.boundaries],
    options.junctions,
    options.hints && [...options.hints],
    options.layerGap,
    options.alignment,
  ])
  let result = recent.get(key)
  if (result) recent.delete(key)
  else {
    result = layOutFitting(nodes, edges, options)
    // A failed layout is not remembered.
    result.catch(() => {
      if (recent.get(key) === result) recent.delete(key)
    })
  }
  recent.set(key, result)
  if (recent.size > recentLimit) recent.delete(recent.keys().next().value!)
  return result
}

/** Lays out once, and again with a wider layer gap while parallel runs that share a gap need more room for full turns. */
async function layOutFitting(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  options: GraphLayoutOptions,
): Promise<GraphLayout> {
  if (options.layerGap !== undefined) return (await layOut(nodes, edges, options, options.layerGap)).layout!
  const widest = layerGap + layerGapGrowth
  let gap = layerGap
  // Each try grows the gap by what the last one lacked, until the runs fit or the growth reaches its limit, keeping
  // the first try's order and alignment (one ELK run each). Large graphs with boundaries, whose dense routes rarely all
  // fit and whose every layout is costly, grow once; smaller ones grow as others do, so routes converging on a hub
  // each keep a track of their own rather than one shared run.
  const attempts = boundaryKinds(options.compound).length && nodes.length > compoundGrowthLimit ? 1 : layerGapAttempts
  // A first try crowded enough to grow the gap to its widest is redone at that width whatever else its routing finds,
  // so its routing stops there (a hub's converging routes cost most in the steps after).
  let laid = await layOut(nodes, edges, options, gap, undefined, widest - gap)
  for (let attempt = 0; attempt < attempts && laid.crowding > 0.5 && gap < widest; attempt++) {
    gap = Math.min(widest, gap + Math.ceil(laid.crowding / 2) * 2)
    laid = await layOut(nodes, edges, options, gap, {...laid.plan, alignment: laid.alignment})
  }
  if (!laid.layout) throw new Error('Graph layout stopped routing without growing its layer gap.')
  return laid.layout
}
