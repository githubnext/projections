// Where cards go: layer and node spacing, ELK's options, and places for hinted cards.
import type {LayoutOptions} from 'elkjs/lib/elk-api.js'
import {arrowHeadReach} from '../arrowhead.js'
import type {Point} from '../edge-arrows.js'
import {routeRadius, routeTail} from '../routes/s-bend.js'
import type {Alignment} from './alignment.js'
import {cardWidth, cardHeight} from './model.js'
import type {LayoutNode} from './model.js'

/** Space between layers: room for a route's tail stub, two full turns (`routeRadius`) and its arrowhead's lead-in. */
export const layerGap = routeTail + 2 * routeRadius + arrowHeadReach + 2
/** Most a layout grows its layer gap to fit parallel runs that share one. */
export const layerGapGrowth = 60
/** How many times a layout grows its layer gap: a grown gap can move routes so that they need a little more. */
export const layerGapAttempts = 3
/** Space a route keeps from a card it passes (ELK `spacing.edgeNode`). */
export const edgeNodeSpacing = 20
/**
 * Space ELK keeps between cards in a layer (ELK `spacing.nodeNode`), and between a card with no relationships and what
 * it is placed beside (see `placeUnlinked`). ELK's placement at this spacing decides each card's layer, order and
 * column; a graph on a grid then spreads its columns to `columnGap` (see `snapToGrid`), which leaves those decisions
 * as they are.
 */
export const nodeSpacing = 24
/**
 * Space between columns on the grid a top-to-bottom layout's cards snap to (see `columnGrid`): a channel for a route between two cards, clear
 * of both (`edgeNodeSpacing` each side), with room to spare, so columns read apart and a relationship can pass
 * between them.
 */
export const columnGap = 2 * edgeNodeSpacing + 8
/** The root's padding on every side. */
export const rootPadding = 32

/** The middle value (the mean of the middle two of an even count; 0 for none). */
export function median(values: readonly number[]): number {
  if (!values.length) return 0
  const sorted = values.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/**
 * Graphs with more relationships than this are placed in one ELK run, with Brandes–Köpf's balanced placement and no
 * ordering pass (see `layOut`), so the largest graphs open as fast as they did before the tidier placement.
 */
export const alignedEdgeLimit = 300

/**
 * The tuned ELK layered configuration: Brandes–Köpf placement (`alignment`,
 * see `layOut`), orthogonal routes (the course a route takes around cards
 * when one S can't reach its target, see `routeEdges`), compact spacing and
 * a fixed seed, so the same graph in the same order always produces the same
 * geometry.
 */
export function elkOptions(
  direction: 'DOWN' | 'RIGHT',
  hinted: boolean,
  gap: number,
  alignment: Alignment | 'NONE' = 'BALANCED',
): LayoutOptions {
  // Growth beyond the standard gap also widens the room ELK keeps for routes between layers, which sets the gap
  // wherever routes pass.
  const growth = Math.max(0, gap - layerGap)
  return {
    'elk.algorithm': 'layered',
    'elk.direction': direction,
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    'elk.layered.nodePlacement.bk.fixedAlignment': alignment,
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'elk.layered.considerModelOrder.strategy': 'NONE',
    // Hinted layouts keep the reference layout's layers and in-layer order (model-order strategies fail on compound graphs).
    ...(hinted ? {'elk.layered.layering.strategy': 'INTERACTIVE', 'elk.layered.crossingMinimization.semiInteractive': 'true'} : {}),
    'elk.spacing.nodeNode': String(nodeSpacing),
    'elk.layered.spacing.nodeNodeBetweenLayers': String(gap),
    'elk.spacing.edgeNode': String(edgeNodeSpacing),
    // A route around cards jogs at least a full turn (and, before its target, the arrowhead's lead-in) from each layer,
    // so every jog becomes an S with the standard radius in the gap, clear of the cards (see `smoothRoute`).
    'elk.spacing.edgeEdge': '14',
    'elk.layered.spacing.edgeNodeBetweenLayers': String(Math.ceil(routeRadius + arrowHeadReach + growth / 2)),
    'elk.randomSeed': '1',
  }
}

/**
 * Layer and in-layer position constraints that reproduce a hinted layout's
 * structure among the cards present, per container (the root or a boundary):
 * cards whose hinted extents start together share a layer, layers keep their
 * order (emptied ones close up), and cards keep their order within a layer.
 */
export function hintedPlaces(
  nodes: readonly LayoutNode[],
  groups: ReadonlyMap<string, string[]>,
  member: ReadonlyMap<string, string>,
  hints: ReadonlyMap<string, Point>,
  direction: 'DOWN' | 'RIGHT',
): Map<string, LayoutOptions> {
  const flow = direction === 'DOWN' ? 'y' : 'x'
  const across = direction === 'DOWN' ? 'x' : 'y'
  const extent = (node: LayoutNode) => (direction === 'DOWN' ? (node.height ?? cardHeight(node.kind)) : (node.width ?? cardWidth))
  const containers = new Map<string, {id: string; start: number; center: number; across: number}[]>()
  for (const node of nodes) {
    const point = hints.get(node.id)
    if (!point || groups.has(node.id)) continue
    const key = member.get(node.id) ?? ''
    const cards = containers.get(key) ?? []
    cards.push({id: node.id, start: point[flow] - extent(node) / 2, center: point[flow], across: point[across]})
    containers.set(key, cards)
  }
  const result = new Map<string, LayoutOptions>()
  for (const cards of containers.values()) {
    cards.sort((a, b) => a.start - b.start || a.across - b.across)
    const layers: (typeof cards)[] = []
    for (const card of cards) {
      const layer = layers.at(-1)
      if (layer && (Math.abs(layer[0]!.start - card.start) < 1 || Math.abs(layer[0]!.center - card.center) < 1)) layer.push(card)
      else layers.push([card])
    }
    for (const [index, layer] of layers.entries()) {
      layer.sort((a, b) => a.across - b.across)
      for (const [position, card] of layer.entries()) {
        result.set(card.id, {
          'elk.layered.layering.layerChoiceConstraint': String(index),
          'elk.layered.crossingMinimization.positionChoiceConstraint': String(position),
        })
      }
    }
  }
  return result
}
