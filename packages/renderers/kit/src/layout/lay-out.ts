// One layout of a graph: ELK places its cards, then the cards with no relationships and the routes are added.
import type {ElkNode} from 'elkjs/lib/elk-api.js'
import type {Point} from '../edge-arrows.js'
import type {LayoutEdge, GraphLayout, GraphLayoutOptions, LayoutNode} from './model.js'
import {median, rootPadding} from './placement.js'
import {routeEdges} from './routing.js'
import {elkInput} from './elk-input.js'
import {elkRun} from './elk-run.js'
import {placeCards} from './elk-placement.js'
import type {Plan} from './elk-placement.js'
import {placeUnlinked} from './unlinked.js'
import {columnGrid, snapToGrid} from './grid.js'
import type {Box} from './unlinked.js'

export async function layOut(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  options: GraphLayoutOptions,
  gap: number,
  given?: Plan,
): Promise<{layout: GraphLayout; crowding: number; plan: Plan}> {
  const input = elkInput(nodes, edges, options)
  const {direction, across, groups, hints, placed, stages, viaJunction, ordered, unlinked, elkId, elkEdges, parts} = input
  // Without a reference layout, ELK first orders the cards to cross least, then places them in that order. Graphs with
  // boundaries keep ELK's own placement, which the boundaries' padding and nesting shape.
  const laidHints = new Map([...hints].filter(([id]) => elkId.has(id)))
  const {result, plan, alignment} = await placeCards(input, elkRun(input, gap), options, laidHints, given)

  const boxes = new Map<string, Box>()
  const visit = (node: ElkNode) => {
    for (const child of node.children ?? []) {
      boxes.set(child.id, {x: child.x ?? NaN, y: child.y ?? NaN, width: child.width ?? NaN, height: child.height ?? NaN})
      visit(child)
    }
  }
  visit(result)
  for (const [id, elk] of elkId) {
    const box = boxes.get(elk)
    if (!box || ![box.x, box.y, box.width, box.height].every(Number.isFinite)) {
      throw new Error(`Graph layout did not produce finite geometry for "${id}".`)
    }
  }
  const polylines = new Map<string, Point[]>()
  for (const edge of result.edges ?? []) {
    const chain = (edge.sections ?? []).flatMap(section => [section.startPoint, ...(section.bendPoints ?? []), section.endPoint])
    if (chain.length && chain.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))) polylines.set(edge.id, chain)
  }

  let width = result.width ?? 0,
    height = result.height ?? 0
  // Cards snap to a grid of columns (see `snapToGrid`), whose courses around the cards replace ELK's.
  const grid = columnGrid(input, boxes)
  let trunks: Map<string, Point[]> | undefined
  if (grid) {
    const snapped = snapToGrid(input, boxes, grid, gap)
    const courses = snapped.courses
    trunks = snapped.reaches
    polylines.clear()
    for (const [id, course] of courses) polylines.set(id, course)
    const reach = Math.max(...[...boxes.values()].map(box => (direction === 'DOWN' ? box.x + box.width : box.y + box.height))) + rootPadding
    if (direction === 'DOWN') width = reach
    else height = reach
  }
  // A step of a transition stays where the reference layout had it: ELK starts every layout at its padding, so one
  // narrower than the reference moves across as a whole to where its cards were. Cards with no relationships (see
  // below) then take their places in the room it leaves.
  if (laidHints.size && !groups.size) {
    let shift = Math.max(
      0,
      median(
        [...laidHints].map(
          ([id, point]) =>
            point[across] - boxes.get(elkId.get(id)!)![across] - boxes.get(elkId.get(id)!)![direction === 'DOWN' ? 'width' : 'height'] / 2,
        ),
      ),
    )
    // On a grid, by whole columns, so the step's cards stay on the reference layout's column lines.
    if (grid) shift = Math.round(shift / grid.pitch) * grid.pitch
    for (const box of boxes.values()) box[across] += shift
    for (const chain of [...polylines.values(), ...(trunks?.values() ?? [])]) for (const point of chain) point[across] += shift
    if (direction === 'DOWN') width += shift
    else height += shift
  }
  const placedUnlinked = unlinked.size ? placeUnlinked(input, boxes, trunks ?? polylines, {width, height}, grid) : undefined
  if (placedUnlinked) ({width, height} = placedUnlinked)
  const points = new Map<string, Point>(),
    sizes = new Map<string, {width: number; height: number}>()
  for (const node of ordered) {
    const box = placedUnlinked?.placed.get(node.id) ?? boxes.get(elkId.get(node.id)!)!
    points.set(node.id, {x: box.x + box.width / 2, y: box.y + box.height / 2})
    sizes.set(node.id, {width: box.width, height: box.height})
  }
  const nodeOf = new Map<string, string>([...elkId].map(([id, elk]) => [elk, id]))
  const {routes, ports, crowding} = routeEdges({
    edges: placed,
    parts: new Map(placed.map(edge => [edge.id, parts.get(edge.id)!])),
    ends: new Map(
      elkEdges.map(edge => [
        edge.id,
        {from: nodeOf.get(edge.sources[0]!) ?? edge.sources[0]!, to: nodeOf.get(edge.targets[0]!) ?? edge.targets[0]!},
      ]),
    ),
    polylines,
    boxes: new Map([
      ...[...points].map(([id, point]) => [id, {...point, ...sizes.get(id)!}] as const),
      ...stages.map((_, index) => {
        const box = boxes.get(`j${index}`)!
        return [`j${index}`, {x: box.x + box.width / 2, y: box.y + box.height / 2, width: 0, height: 0}] as const
      }),
    ]),
    cards: new Set([...points.keys()].filter(id => !groups.has(id))),
    loose: unlinked,
    direction,
    gap,
    grid: Boolean(grid),
  })
  const junctions = stages.map((_, index) => {
    const box = boxes.get(`j${index}`)!
    return {x: box.x + box.width / 2, y: box.y + box.height / 2}
  })
  return {
    layout: {
      points,
      sizes,
      routes,
      groups,
      junctions,
      shared: new Set(viaJunction.keys()),
      ports,
      layerGap: gap,
      alignment,
      width,
      height,
    },
    crowding,
    plan,
  }
}
