// Unlinked cards moved onto the columns of the cards around them.
import {nodeSpacing, rootPadding} from './placement.js'
import type {Axes, Block, Box} from './unlinked.js'

/** How far an unlinked card moves to line up with a card in another layer: closer than this reads as a slip. */
export const columnReach = 2 * nodeSpacing

/**
 * Moves each of `ids` (placed in `placed`, with its own block in `blocks`) onto the leading edge, across the flow, of
 * a card in another layer when that edge is within `columnReach` of its own and the card fits there clear of every
 * card, boundary and route, so unlinked cards line up in the columns of the rest (and of one another) rather than
 * sitting a few units off them. The nearest edge wins; edges further on wait for the cards they depend on to move.
 * Returns how far the layout reaches across the flow afterwards.
 */
export function alignColumns(
  ids: readonly string[],
  placed: Map<string, Box>,
  own: Map<string, Block>,
  blocks: Block[],
  {flow, across, depth, breadth}: Axes,
  reach: number,
): number {
  let extent = reach
  for (let pass = 0; pass < 3; pass++) {
    let moved = false
    for (const id of ids) {
      const box = placed.get(id)!
      const mine = own.get(id)!
      const start = box[flow],
        end = box[flow] + box[depth]
      const overlaps = (block: Block) => block.flow.start < end - 0.5 && block.flow.end > start + 0.5
      const columns = blocks.filter(block => block !== mine && block.card && !overlaps(block)).map(block => block.across.start)
      // A card already in a column stays in it.
      if (columns.some(edge => Math.abs(edge - box[across]) <= 0.5)) continue
      const edges = columns
        .filter(edge => Math.abs(edge - box[across]) > 0.5 && Math.abs(edge - box[across]) <= columnReach && edge >= rootPadding)
        .toSorted((a, b) => Math.abs(a - box[across]) - Math.abs(b - box[across]) || a - b)
      const near = blocks.filter(block => block !== mine && overlaps(block))
      const fits = (edge: number) =>
        near.every(block => block.across.end + nodeSpacing <= edge + 0.5 || block.across.start - nodeSpacing >= edge + box[breadth] - 0.5)
      const edge = edges.find(fits)
      if (edge === undefined) continue
      box[across] = edge
      mine.across = {start: edge, end: edge + box[breadth]}
      extent = Math.max(extent, edge + box[breadth] + rootPadding)
      moved = true
    }
    if (!moved) break
  }
  return extent
}
