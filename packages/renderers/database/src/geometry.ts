import {compareIds} from '@githubnext/projections-renderer-kit'
import {textMetrics} from './text.js'
import type {TextSizer} from './text.js'
import type {SchemaBox, SchemaModel} from './schema.js'
import {schemaMetrics} from './schema.js'

/** Where a link meets a card: the middle of a row's first line, or of the header's first line. */
export const anchorY = (box: SchemaBox, top: number | undefined, header: number) =>
  box.y + (top === undefined ? Math.min(header, textMetrics.header) / 2 : top + textMetrics.line / 2 + textMetrics.rowPad)

/** Row offsets and heights and header heights of one stage's cards on cards `cardWidth` wide. */
export interface Geometry {
  offsets: Map<string, number>
  heights: Map<string, number>
  headers: Map<string, number>
  statuses: Map<string, number>
}
export function rowGeometry(model: SchemaModel, cardWidth: number, sizer: TextSizer): Geometry {
  const offsets = new Map<string, number>(),
    heights = new Map<string, number>(),
    headers = new Map<string, number>(),
    statuses = new Map<string, number>()
  for (const table of model.tables) {
    const header = sizer.header(table, cardWidth)
    headers.set(table, header)
    statuses.set(table, sizer.status(table))
    let top = header
    for (const id of model.columns.get(table)!) {
      const height = sizer.row(id, cardWidth)
      offsets.set(id, top)
      heights.set(id, height)
      top += height
    }
  }
  return {offsets, heights, headers, statuses}
}
export const cardHeight = (model: SchemaModel, table: string, geometry: Geometry) => {
  const rows = model.columns.get(table)!
  return geometry.headers.get(table)! + (rows.length ? rows.reduce((sum, id) => sum + geometry.heights.get(id)!, 0) : schemaMetrics.row)
}
export const anchor = (geometry: Geometry, box: SchemaBox, table: string, column?: string) =>
  anchorY(box, column === undefined ? undefined : geometry.offsets.get(column), geometry.headers.get(table)!)

/**
 * Keeps the cards a later stage also shows in that stage's order: they take
 * the places `list` gives its cards that `later` knows, in `later`'s order,
 * and every other card keeps its own place. So stages agree on the relative
 * order of the cards they share, and an added card inserts without reordering
 * the others.
 */
export function keepOrder(list: string[], later: ReadonlyMap<string, number> | undefined): string[] {
  if (!later) return list
  const slots = list.flatMap((id, index) => (later.has(id) ? [index] : []))
  const kept = slots.map(index => list[index]!).sort((a, b) => later.get(a)! - later.get(b)!)
  const result = [...list]
  slots.forEach((slot, index) => (result[slot] = kept[index]!))
  return result
}

/** Orders each rank by the mean position of its neighbours, sweeping both ways to reduce crossings. */
export function orderRanks(model: SchemaModel, later?: ReadonlyMap<string, number>): string[][] {
  const maxRank = Math.max(0, ...model.rank.values())
  const ranks: string[][] = Array.from({length: maxRank + 1}, () => [])
  for (const table of model.tables) ranks[model.rank.get(table)!]!.push(table)
  const degree = (table: string) => model.links.filter(link => link.principal === table || link.dependent === table).length
  for (const rank of ranks) rank.sort((a, b) => degree(b) - degree(a) || compareIds(a, b))
  const neighbours = (table: string) =>
    model.links.flatMap(link => (link.principal === table ? [link.dependent] : link.dependent === table ? [link.principal] : []))
  const sweep = (index: number, reference: number) => {
    const position = new Map(ranks[reference]!.map((table, order) => [table, order]))
    const weight = new Map(
      ranks[index]!.map((table, order) => {
        const near = neighbours(table)
          .filter(other => position.has(other))
          .map(other => position.get(other)!)
        return [table, near.length ? near.reduce((sum, value) => sum + value, 0) / near.length : order]
      }),
    )
    ranks[index]!.sort((a, b) => weight.get(a)! - weight.get(b)! || compareIds(a, b))
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let index = 1; index < ranks.length; index++) sweep(index, index - 1)
    for (let index = ranks.length - 2; index >= 0; index--) sweep(index, index + 1)
  }
  return ranks.map(rank => keepOrder(rank, later))
}
