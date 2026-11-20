// Cards on a grid: one pitch across the flow, and every card's leading edge on a column line in every layer.
import type {Point} from '../edge-arrows.js'
import {cardHeight, cardWidth} from './model.js'
import {columnGap, median, nodeSpacing, rootPadding} from './placement.js'
import type {ElkInput} from './elk-input.js'
import type {Box} from './unlinked.js'

/** Column lines across the flow: `origin`, then every `pitch`. */
export interface Grid {
  origin: number
  pitch: number
  /** The pitch of ELK's placement (its cards `nodeSpacing` apart), by which a card's column is read. */
  laid: number
}

/**
 * The grid a layout's cards snap to (see `snapToGrid`): column lines `columnGap` apart beyond the cards' usual breadth
 * across the flow (rows `nodeSpacing` apart, left to right), from the root's padding. A graph with boundaries keeps ELK's placement, which their padding
 * and nesting shape, as does a left-to-right graph whose cards differ in height.
 */
export function columnGrid(input: ElkInput, boxes: ReadonlyMap<string, Box>): Grid | undefined {
  const {groups, laid, elkId, nodes, unlinked, direction} = input
  if (groups.size) return undefined
  const breadth = direction === 'DOWN' ? 'width' : 'height'
  const breadths = [
    ...laid.map(node => boxes.get(elkId.get(node.id)!)![breadth]),
    // An unlinked card's size as it is placed (`placeUnlinked`): its own, or a card's.
    ...nodes
      .filter(node => unlinked.has(node.id))
      .map(node => (direction === 'DOWN' ? (node.width ?? cardWidth) : (node.height ?? cardHeight(node.kind)))),
  ].filter(value => value > 0)
  if (!breadths.length) return undefined
  // Left to right, cards of different heights (their text, their changes) would leave rows half empty: they keep
  // ELK's placement.
  if (direction === 'RIGHT' && Math.max(...breadths) - Math.min(...breadths) > 0.5) return undefined
  // Top to bottom, columns spread to a route channel apart; left to right, rows keep ELK's spacing.
  const gap = direction === 'DOWN' ? columnGap : nodeSpacing
  return {origin: rootPadding, pitch: median(breadths) + gap, laid: median(breadths) + nodeSpacing}
}

/**
 * How many columns a card of `breadth` spans: one, or more for a card wider than the pitch (a hub, say), counted as
 * ELK placed it, so it spans as many wider columns.
 */
export function columnSpan(grid: Grid, breadth: number): number {
  return Math.max(1, Math.ceil((breadth + nodeSpacing) / grid.laid - 1e-6))
}

/** The column line at or after `value` (`up`), or at or before it. */
export function columnLine(grid: Grid, value: number, up: boolean): number {
  const index = (value - grid.origin) / grid.pitch
  return grid.origin + (up ? Math.ceil(index - 1e-6) : Math.floor(index + 1e-6)) * grid.pitch
}

/**
 * Moves the cards ELK laid out onto `grid`'s column lines, layer by layer, keeping their order in each layer and moving
 * them as little as possible (a card ELK lined up with another in the next layer, so the relationship between them runs
 * straight, lands in the same column as it), never closer than a column apart. A card's column is read at ELK's
 * pitch (`grid.laid`), so spreading the columns to `columnGap` keeps every card's column. Junctions move to the middle of the
 * cards they join. Returns, for every ELK edge, a course around the cards for routes that no S or corridor between
 * cards can take (see `routeEdges`), as ELK's own courses no longer fit the moved cards; and its reach, a line from
 * its source's port to its target's whose span (the room between them, where its route runs straight, turns or finds a
 * corridor) cards with no relationships keep clear of (see `placeUnlinked`).
 */
export function snapToGrid(
  input: ElkInput,
  boxes: Map<string, Box>,
  grid: Grid,
  gap: number,
): {courses: Map<string, Point[]>; reaches: Map<string, Point[]>} {
  const {direction, laid, elkId, stages, elkEdges} = input
  const flow = direction === 'DOWN' ? 'y' : 'x',
    across = direction === 'DOWN' ? 'x' : 'y'
  const depth = direction === 'DOWN' ? 'height' : 'width',
    breadth = direction === 'DOWN' ? 'width' : 'height'
  const cards = laid.map(node => boxes.get(elkId.get(node.id)!)!).sort((a, b) => a[flow] - b[flow] || a[across] - b[across])
  const layers: Box[][] = []
  for (const box of cards) {
    const layer = layers.at(-1)
    if (layer && Math.abs(layer[0]![flow] - box[flow]) < 1) layer.push(box)
    else layers.push([box])
  }
  for (const layer of layers) {
    layer.sort((a, b) => a[across] - b[across])
    const columns = placeInColumns(
      layer.map(box => (box[across] - grid.origin) / grid.laid),
      layer.map(box => columnSpan(grid, box[breadth])),
    )
    layer.forEach((box, index) => (box[across] = grid.origin + columns[index]! * grid.pitch))
  }
  const centre = (box: Box) => box[across] + box[breadth] / 2
  for (const [index, stage] of stages.entries()) {
    const junction = boxes.get(`j${index}`)
    const joined = [...stage.sources, ...stage.targets].map(id => boxes.get(elkId.get(id)!)).filter(box => box !== undefined)
    if (junction && joined.length) junction[across] = median(joined.map(centre)) - junction[breadth] / 2
  }
  // Around the cards: out of the source into the gap after it, across to a lane outside every card, along it, and
  // across the gap before the target into it.
  const all = [...boxes.values()]
  const lanes = [
    Math.min(...all.map(box => box[across])) - (grid.pitch - grid.laid + nodeSpacing) / 2,
    Math.max(...all.map(box => box[across] + box[breadth])) + (grid.pitch - grid.laid + nodeSpacing) / 2,
  ]
  const at = (along: number, side: number): Point => (direction === 'DOWN' ? {x: side, y: along} : {x: along, y: side})
  const courses = new Map<string, Point[]>(),
    reaches = new Map<string, Point[]>()
  for (const edge of elkEdges) {
    const from = boxes.get(edge.sources[0]!)!,
      to = boxes.get(edge.targets[0]!)!
    const start = from[flow] + from[depth],
      end = to[flow]
    const [out, into] = [centre(from), centre(to)]
    const lane = lanes.reduce((best, side) => (Math.abs(side - (out + into) / 2) < Math.abs(best - (out + into) / 2) ? side : best))
    const leave = start + Math.min(gap / 2, Math.max(0, (end - start) / 2)),
      arrive = end - Math.min(gap / 2, Math.max(0, (end - start) / 2))
    courses.set(
      edge.id,
      Math.abs(out - into) < 0.5 && end - start <= gap + 1
        ? [at(start, out), at(end, into)]
        : [at(start, out), at(leave, out), at(leave, lane), at(arrive, lane), at(arrive, into), at(end, into)],
    )
    reaches.set(edge.id, [at(start, out), at(end, into)])
  }
  return {courses, reaches}
}

/**
 * Integer columns for cards in a layer, in order: each at least the previous one's column and span on, and in all as
 * near their `wanted` (fractional) columns as can be, with ties to the left. Pools runs of cards pressed together
 * and gives each run the median offset its cards want (isotonic regression in the L1 sense).
 */
export function placeInColumns(wanted: readonly number[], spans: readonly number[]): number[] {
  const offsets: number[] = []
  let total = 0
  for (const span of spans) {
    offsets.push(total)
    total += span
  }
  const runs: {from: number; to: number; at: number}[] = []
  const best = (from: number, to: number) =>
    Math.round(median(wanted.slice(from, to + 1).map((value, index) => value - offsets[from + index]!)))
  for (let index = 0; index < wanted.length; index++) {
    runs.push({from: index, to: index, at: best(index, index)})
    while (runs.length > 1 && runs.at(-2)!.at > runs.at(-1)!.at) {
      const last = runs.pop()!
      const previous = runs.at(-1)!
      previous.to = last.to
      previous.at = best(previous.from, previous.to)
    }
  }
  const columns: number[] = []
  let floor = 0
  for (const run of runs) {
    for (let index = run.from; index <= run.to; index++) {
      const column = Math.max(floor, run.at + offsets[index]!)
      columns.push(column)
      floor = column + spans[index]!
    }
  }
  return columns
}
