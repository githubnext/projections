// Where ELK places the cards: in a reference layout's order, or ordered to cross least and then aligned.
import type {ElkExtendedEdge, ElkNode} from 'elkjs/lib/elk-api.js'
import type {Point} from '../edge-arrows.js'
import type {GraphLayoutOptions} from './model.js'
import {identifyAlignment, type Alignment, type LayeredEdge, type LayeredNode} from './alignment.js'
import {alignedEdgeLimit, median} from './placement.js'
import type {ElkInput} from './elk-input.js'
import type {ElkRun} from './elk-run.js'

/** What a layout's ELK placement run was given (see `layOut`), so a wider gap places the cards the same way. */
export interface Plan {
  order: ReadonlyMap<string, Point>
  /** `NONE`: ELK's narrowest of the four. */
  alignment: Alignment | 'NONE'
}

export interface Placement {
  result: ElkNode
  plan: Plan
  alignment: Alignment
}

/**
 * The placed ELK result. Without a reference layout, ELK first orders the cards to cross least, then places them in
 * that order. Graphs with boundaries keep ELK's own placement, which the boundaries' padding and nesting shape.
 */
export function placeCards(
  input: ElkInput,
  run: ElkRun,
  options: GraphLayoutOptions,
  laidHints: ReadonlyMap<string, Point>,
  given?: Plan,
): Promise<Placement> {
  const {direction, across, byElk, elkEdges} = input
  /**
   * The layers and order of an ELK result, and where its long relationships cross the layers between their ends, for
   * `identifyAlignment`. Junctions are nodes too.
   */
  const layering = (result: ElkNode) => {
    const flow = direction === 'DOWN' ? 'y' : 'x'
    const depth = direction === 'DOWN' ? 'height' : 'width'
    const placedNodes = (result.children ?? []).map(child => ({
      id: child.id,
      start: child[flow] ?? 0,
      middle: (child[flow] ?? 0) + (child[depth] ?? 0) / 2,
      across: (child[across] ?? 0) + (child[direction === 'DOWN' ? 'width' : 'height'] ?? 0) / 2,
    }))
    const starts = [...new Set(placedNodes.map(node => Math.round(node.start)))].toSorted((a, b) => a - b)
    const layerOf = (start: number) => starts.findIndex(value => Math.abs(value - Math.round(start)) < 1)
    const middles = starts.map(start =>
      median(placedNodes.filter(node => Math.abs(Math.round(node.start) - start) < 1).map(node => node.middle)),
    )
    const layered = new Map<string, LayeredNode>(placedNodes.map(node => [node.id, {layer: layerOf(node.start), across: node.across}]))
    const sections = new Map((result.edges ?? []).map(edge => [edge.id, edge.sections ?? []]))
    const lines: LayeredEdge[] = elkEdges.map(edge => {
      const [from, to] = [edge.sources[0]!, edge.targets[0]!]
      const chain = (sections.get(edge.id) ?? []).flatMap(section => [section.startPoint, ...(section.bendPoints ?? []), section.endPoint])
      const first = layered.get(from)?.layer ?? 0,
        last = layered.get(to)?.layer ?? 0
      const through: number[] = []
      for (let layer = first + 1; layer < last; layer++) {
        const at = middles[layer]!
        const leg = chain.findIndex((point, index) => index > 0 && (chain[index - 1]![flow] - at) * (point[flow] - at) <= 0)
        through.push(leg > 0 ? chain[leg]![across] : (layered.get(from)!.across + layered.get(to)!.across) / 2)
      }
      return {from, to, through}
    })
    return {nodes: layered, edges: lines}
  }
  /**
   * The cards placed in one of the four Brandes–Köpf alignments rather than their balanced average, which centres a
   * card between its neighbours and so bends every relationship off it: each alignment keeps whole chains of cards in
   * columns, so a card sits over the card it links to wherever it can and that relationship runs straight. Without a
   * reference layout, ELK first orders the cards to cross least (one run), then places them in that order with the
   * narrowest of the four alignments (`NONE`, one more run), and the layout records which that was
   * (`identifyAlignment`). A transition's steps take their union's order and alignment: one run each.
   */
  const aligned = async (reference: ReadonlyMap<string, Point> | undefined): Promise<Placement> => {
    if (!elkEdges.length || elkEdges.length > alignedEdgeLimit || options.alignment === 'BALANCED') {
      const plan = {order: reference ?? new Map<string, Point>(), alignment: 'BALANCED' as const}
      return {result: await run(plan.order, false), plan, alignment: 'BALANCED'}
    }
    const order = reference ?? centres(await run(new Map(), false, 'BALANCED', true))
    return place({order, alignment: options.alignment ?? 'NONE'})
  }
  /** One placement run with a plan's order and alignment, and the alignment it used. */
  async function place(plan: Plan): Promise<Placement> {
    const result = await run(plan.order, plan.alignment !== 'BALANCED', plan.alignment)
    if (plan.alignment !== 'NONE') return {result, plan, alignment: plan.alignment}
    const {nodes: layered, edges: lines} = layering(result)
    const found = centres(result)
    const straight = new Set(
      elkEdges.flatMap((edge, index) => {
        const [from, to] = [found.get(byElk.get(edge.sources[0]!) ?? ''), found.get(byElk.get(edge.targets[0]!) ?? '')]
        return from && to && Math.abs(from[across] - to[across]) < 0.5 ? [index] : []
      }),
    )
    return {result, plan, alignment: identifyAlignment(layered, lines, straight)}
  }
  /** Card and boundary centres of an ELK result, by card ID. */
  function centres(result: ElkNode) {
    const found = new Map<string, Point>()
    const visit = (node: ElkNode) => {
      for (const child of node.children ?? []) {
        const id = byElk.get(child.id)
        if (id !== undefined) found.set(id, {x: (child.x ?? 0) + (child.width ?? 0) / 2, y: (child.y ?? 0) + (child.height ?? 0) / 2})
        visit(child)
      }
    }
    visit(result)
    return found
  }
  return given ? place(given) : input.groups.size ? balanced(run, laidHints) : aligned(laidHints.size ? laidHints : undefined)
}

async function balanced(run: ElkRun, laidHints: ReadonlyMap<string, Point>): Promise<Placement> {
  return {result: await run(laidHints, false), plan: {order: laidHints, alignment: 'BALANCED' as const}, alignment: 'BALANCED' as const}
}
