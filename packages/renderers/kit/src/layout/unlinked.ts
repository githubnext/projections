// Cards with no relationships, placed on the rest's layers where it leaves room.
import {cardWidth, cardHeight, compareIds} from './model.js'
import {layerGap, nodeSpacing, rootPadding} from './placement.js'
import type {ElkInput} from './elk-input.js'
import type {Point} from '../edge-arrows.js'
import {alignColumns} from './unlinked-columns.js'
import {columnLine, type Grid} from './grid.js'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

interface Span {
  start: number
  end: number
}

/** What a card keeps clear of, along the flow and across it: a card, or a boundary, junction or route. */
export interface Block {
  flow: Span
  across: Span
  card: boolean
}

/** A free stretch across a layer, and whether a card bounds it before or after. */
interface Stretch extends Span {
  cardBefore: boolean
  cardAfter: boolean
}

export interface Axes {
  flow: 'x' | 'y'
  across: 'x' | 'y'
  depth: 'width' | 'height'
  breadth: 'width' | 'height'
}

const span = (a: number, b: number): Span => ({start: Math.min(a, b), end: Math.max(a, b)})

/** Whether cost `a` comes before cost `b`, comparing their terms in order. */
const cheaper = (a: readonly number[], b: readonly number[]) => {
  for (const [index, term] of a.entries()) if (term !== b[index]) return term < b[index]!
  return false
}

/** A place for a card: where it starts along the flow and across it, and what it costs. */
interface Place {
  flow: number
  across: number
  cost: number[]
}

/**
 * Places `input.unlinked` on the layers of the rest, in room it leaves, without moving anything ELK placed: a card
 * with no relationships never gets a row or a column of its own, and never pushes the rest away. Each card starts
 * where the cards of its layer start and keeps `nodeSpacing` from every card, boundary and route. A hinted card (a
 * step of a transition) takes the free place nearest its hint, moved with the card nearest it, so it stays beside it
 * while its relationships come and go. The rest, like the sources they are, go in the earliest layer (beside the
 * roots), next to a card: each later layer costs a third of growing the layout by a row of cards, so they fill the
 * first layer's room, or grow it a little, and many form a block up to three layers wide past the end across the
 * flow. A card a little off the column of a card in another layer moves onto it where it fits (`alignColumns`). They
 * take their places in reading order. Returns where each unlinked card goes and the layout's new size.
 */
export function placeUnlinked(
  input: ElkInput,
  boxes: ReadonlyMap<string, Box>,
  polylines: ReadonlyMap<string, Point[]>,
  size: {width: number; height: number},
  columns?: Grid,
): {placed: Map<string, Box>; width: number; height: number} {
  const {direction, across, unlinked, hints, ordered} = input
  const axes: Axes =
    direction === 'DOWN' ? {flow: 'y', across, depth: 'height', breadth: 'width'} : {flow: 'x', across, depth: 'width', breadth: 'height'}
  const {flow, depth, breadth} = axes
  const slots = layerSlots(input, boxes, axes)
  const blocks = obstacles(input, boxes, polylines, axes)
  const sizes = new Map(
    ordered
      .filter(node => unlinked.has(node.id))
      .map(node => [node.id, {width: node.width ?? cardWidth, height: node.height ?? cardHeight(node.kind)}]),
  )
  const extent = {flow: size[depth], across: size[breadth]}
  const hinted = [...unlinked]
    .filter(id => hints.has(id))
    .sort((a, b) => hints.get(a)![across] - hints.get(b)![across] || hints.get(a)![flow] - hints.get(b)![flow] || compareIds(a, b))
  const rest = [...unlinked].filter(id => !hints.has(id)).sort(compareIds)
  const placed = new Map<string, Box>()
  const own = new Map<string, Block>()
  const target = relativeHints(input, boxes)
  // With nothing else laid out, the cards make a grid as many layers wide as it has lines.
  const grid = !input.laid.length && !hinted.length ? slots.length : 0
  for (const [index, id] of [...hinted, ...rest].entries()) {
    const card = sizes.get(id)!
    const best = grid
      ? gridPlace(axes, slots, placed, rest, index, grid, columns)
      : bestPlace(input, axes, slots, blocks, extent, card, target(id), columns)
    const box = {...card, [flow]: best.flow, [across]: best.across} as Box
    placed.set(id, box)
    const block = {flow: span(box[flow], box[flow] + box[depth]), across: span(box[across], box[across] + box[breadth]), card: true}
    own.set(id, block)
    blocks.push(block)
    extent.flow = Math.max(extent.flow, box[flow] + box[depth] + rootPadding)
    extent.across = Math.max(extent.across, box[across] + box[breadth] + rootPadding)
  }
  // Off a grid of columns, cards a little off a column line up with it.
  if (!grid && !columns) extent.across = alignColumns(rest, placed, own, blocks, axes, extent.across)
  inReadingOrder(rest, placed, axes)
  return direction === 'DOWN' ? {placed, width: extent.across, height: extent.flow} : {placed, width: extent.flow, height: extent.across}
}

/** The cheapest free place for `card` on any layer: nearest `hint`, or else as `placeUnlinked` prefers. */
function bestPlace(
  input: ElkInput,
  {depth, breadth}: Axes,
  slots: readonly Span[],
  blocks: readonly Block[],
  extent: {flow: number; across: number},
  card: {width: number; height: number},
  hint: Point | undefined,
  columns?: Grid,
): Place {
  const {direction, groups, across} = input
  const flow = across === 'x' ? 'y' : 'x'
  // Each later layer costs a third of what one more row of cards across the whole layout would add to its area.
  const layerCost = ((card[breadth] + nodeSpacing) * extent.flow) / 3
  let best: Place | undefined
  for (const [layer, slot] of slots.entries()) {
    // At the start of the layer, like the cards in it (in the middle of a top-to-bottom layer with boundaries).
    const start = direction === 'RIGHT' || !groups.size ? slot.start : (slot.start + slot.end - card[depth]) / 2
    const end = start + card[depth]
    const near = blocks.filter(block => block.flow.start < end - 0.5 && block.flow.end > start + 0.5)
    for (const stretch of stretches(near)) {
      if (stretch.end - stretch.start < card[breadth]) continue
      const ends = columns
        ? {start: columnLine(columns, stretch.start, true), end: columnLine(columns, stretch.end - card[breadth], false) + card[breadth]}
        : stretch
      if (ends.end - ends.start < card[breadth] - 0.5) continue
      const wanted = hint && Math.max(ends.start, Math.min(hint[across] - card[breadth] / 2, ends.end - card[breadth]))
      const positions =
        wanted !== undefined
          ? [columns ? columnLine(columns, wanted + columns.pitch / 2, false) : wanted].map(at => Math.max(ends.start, at))
          : [ends.start, ends.end - card[breadth]].filter(Number.isFinite)
      for (const position of positions) {
        const growth =
          Math.max(extent.flow, end + rootPadding) * Math.max(extent.across, position + card[breadth] + rootPadding) -
          extent.flow * extent.across
        const beside = position === ends.start ? stretch.cardBefore : stretch.cardAfter
        const cost = hint
          ? [Math.hypot(start + card[depth] / 2 - hint[flow], position + card[breadth] / 2 - hint[across]), growth, layer, position]
          : [growth + layer * layerCost, beside ? 0 : 1, layer, position]
        if (!best || cheaper(cost, best.cost)) best = {flow: start, across: position, cost}
      }
    }
  }
  return best!
}

/**
 * A card's place in the grid of a layout with nothing else: its layer, and after the card before it in its layer, on
 * the next of the layout's column lines (`grid`, a pitch apart) when it has them.
 */
function gridPlace(
  {across, breadth}: Axes,
  slots: readonly Span[],
  placed: ReadonlyMap<string, Box>,
  ids: readonly string[],
  index: number,
  layers: number,
  grid?: Grid,
): Place {
  const layer = index % layers
  const previous = index >= layers ? placed.get(ids[index - layers]!) : undefined
  const after = previous ? previous[across] + previous[breadth] + nodeSpacing : rootPadding
  return {flow: slots[layer]!.start, across: grid ? columnLine(grid, after, true) : after, cost: []}
}

/** Gives the places `ids` took to them again in ID order, read along the flow then across, among cards of one size. */
function inReadingOrder(ids: readonly string[], placed: Map<string, Box>, {flow, across}: Axes): void {
  const bySize = new Map<string, string[]>()
  for (const id of ids) {
    const box = placed.get(id)!
    const key = `${box.width}x${box.height}`
    bySize.set(key, [...(bySize.get(key) ?? []), id])
  }
  for (const group of bySize.values()) {
    const places = group.map(id => placed.get(id)!).sort((a, b) => a[flow] - b[flow] || a[across] - b[across])
    for (const [index, id] of group.entries()) placed.set(id, places[index]!)
  }
}

/**
 * Where a hinted card aims: its hint, moved as far as the nearest hinted card ELK laid out moved from its own hint, so
 * it stays beside the same card when the rest is laid out elsewhere than in the reference layout.
 */
function relativeHints(input: ElkInput, boxes: ReadonlyMap<string, Box>) {
  const {hints, laid, groups, elkId} = input
  const anchors = laid
    .filter(node => !groups.has(node.id) && hints.has(node.id))
    .map(node => {
      const box = boxes.get(elkId.get(node.id)!)!
      const hint = hints.get(node.id)!
      return {id: node.id, hint, shift: {x: box.x + box.width / 2 - hint.x, y: box.y + box.height / 2 - hint.y}}
    })
  return (id: string): Point | undefined => {
    const hint = hints.get(id)
    if (!hint || !anchors.length) return hint
    const nearest = anchors.reduce(
      (best, anchor) => {
        const distance = Math.hypot(anchor.hint.x - hint.x, anchor.hint.y - hint.y)
        return distance < best.distance || (distance === best.distance && compareIds(anchor.id, best.anchor.id) < 0)
          ? {anchor, distance}
          : best
      },
      {anchor: anchors[0]!, distance: Infinity},
    ).anchor
    return {x: hint.x + nearest.shift.x, y: hint.y + nearest.shift.y}
  }
}

/**
 * The layers: the spans along the flow that the laid-out cards occupy, continued at the same pitch to at least √n
 * layers for n unlinked cards, so many of them fill a few layers rather than one long one.
 */
function layerSlots(input: ElkInput, boxes: ReadonlyMap<string, Box>, {flow, depth}: Axes): Span[] {
  const {groups, laid, elkId, unlinked} = input
  const layers: Span[] = []
  for (const extent of laid
    .filter(node => !groups.has(node.id))
    .map(node => boxes.get(elkId.get(node.id)!)!)
    .map(box => ({start: box[flow], end: box[flow] + box[depth]}))
    .sort((a, b) => a.start - b.start || a.end - b.end)) {
    const layer = layers.at(-1)
    if (layer && extent.start < layer.end) layer.end = Math.max(layer.end, extent.end)
    else layers.push({...extent})
  }
  // With nothing else laid out, the cards make their own first layer.
  if (!layers.length) {
    const deepest = Math.max(
      ...input.ordered
        .filter(node => unlinked.has(node.id))
        .map(node => (depth === 'width' ? (node.width ?? cardWidth) : (node.height ?? cardHeight(node.kind)))),
    )
    layers.push({start: rootPadding, end: rootPadding + deepest})
  }
  const laidCount = layers.length
  const last = layers.at(-1)!
  const pitch = laidCount > 1 ? last.start - layers.at(-2)!.start : last.end - last.start + layerGap
  for (let index = laidCount; index < Math.ceil(Math.sqrt(unlinked.size)); index++) {
    const start = last.start + pitch * (index - laidCount + 1)
    layers.push({start, end: start + last.end - last.start})
  }
  return layers
}

/** Every laid-out card, boundary and junction, and every segment of every route. */
function obstacles(input: ElkInput, boxes: ReadonlyMap<string, Box>, polylines: ReadonlyMap<string, Point[]>, axes: Axes): Block[] {
  const {flow, across, depth, breadth} = axes
  const blocks: Block[] = []
  for (const [elk, box] of boxes) {
    const id = input.byElk.get(elk)
    blocks.push({
      flow: span(box[flow], box[flow] + box[depth]),
      across: span(box[across], box[across] + box[breadth]),
      card: id !== undefined && !input.groups.has(id),
    })
  }
  for (const chain of polylines.values()) {
    for (let index = 1; index < chain.length; index++) {
      const from = chain[index - 1]!,
        to = chain[index]!
      blocks.push({flow: span(from[flow], to[flow]), across: span(from[across], to[across]), card: false})
    }
  }
  return blocks
}

/** The free stretches across a layer among `blocks`, each kept `nodeSpacing` clear, from the root's padding on. */
function stretches(blocks: readonly Block[]): Stretch[] {
  const taken = blocks
    .map(block => ({start: block.across.start - nodeSpacing, end: block.across.end + nodeSpacing, card: block.card}))
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const result: Stretch[] = []
  let cursor = rootPadding,
    cardBefore = false
  for (const block of taken) {
    if (block.start > cursor) result.push({start: cursor, end: block.start, cardBefore, cardAfter: block.card})
    if (block.end > cursor) {
      cursor = block.end
      cardBefore = block.card
    }
  }
  result.push({start: cursor, end: Infinity, cardBefore, cardAfter: false})
  return result
}
