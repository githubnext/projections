import {compareIds} from '@githubnext/projections-renderer-kit'
import type {TextSizer} from './text.js'
import {anchor, cardHeight, orderRanks, rowGeometry} from './geometry.js'
import {schemaMetrics} from './schema.js'
import type {SchemaBox, SchemaLayout, SchemaModel, SchemaPoint} from './schema.js'

export function laneAssignments(
  model: SchemaModel,
  cardWidth: number,
  sizer: TextSizer,
  later?: ReadonlyMap<string, number>,
): Map<string, number> {
  let y = 0
  const boxes = new Map<string, SchemaBox>()
  const geometry = rowGeometry(model, cardWidth, sizer)
  for (const table of orderRanks(model, later).flat()) {
    const height = cardHeight(model, table, geometry)
    boxes.set(table, {x: 0, y, width: 0, height})
    y += height + schemaMetrics.tableGap
  }
  const spans = model.links
    .map(link => {
      const a = anchor(geometry, boxes.get(link.dependent)!, link.dependent, link.dependentColumn)
      const b = anchor(geometry, boxes.get(link.principal)!, link.principal, link.principalColumn)
      return {key: link.key, top: Math.min(a, b), bottom: Math.max(a, b)}
    })
    .sort((a, b) => a.bottom - a.top - (b.bottom - b.top) || compareIds(a.key, b.key))
  const lanes: {top: number; bottom: number}[][] = []
  const result = new Map<string, number>()
  for (const span of spans) {
    let lane = lanes.findIndex(items => items.every(item => item.bottom < span.top || item.top > span.bottom))
    if (lane < 0) {
      lane = lanes.length
      lanes.push([])
    }
    lanes[lane]!.push(span)
    result.set(span.key, lane)
  }
  return result
}

export function stackLayout(
  model: SchemaModel,
  cardWidth: number,
  gutter: number,
  sizer: TextSizer,
  later?: ReadonlyMap<string, number>,
): SchemaLayout {
  const tables = new Map<string, SchemaBox>()
  const rows = new Map<string, number>()
  const geometry = rowGeometry(model, cardWidth, sizer)
  let y = 0
  for (const table of orderRanks(model, later).flat()) {
    const height = cardHeight(model, table, geometry)
    tables.set(table, {x: gutter, y, width: cardWidth, height})
    model.columns.get(table)!.forEach((column, index) => {
      rows.set(column, index)
    })
    y += height + schemaMetrics.tableGap
  }
  const lanes = laneAssignments(model, cardWidth, sizer, later)
  const routes = new Map<string, SchemaPoint[]>()
  for (const link of model.links) {
    const laneX = gutter - schemaMetrics.gutterPad - lanes.get(link.key)! * schemaMetrics.lane
    const from = anchor(geometry, tables.get(link.dependent)!, link.dependent, link.dependentColumn)
    const to = anchor(geometry, tables.get(link.principal)!, link.principal, link.principalColumn)
    routes.set(link.key, [
      {x: laneX, y: from},
      {x: laneX, y: to},
    ])
  }
  return {
    mode: 'stack',
    cardWidth,
    tables,
    rows,
    ...geometry,
    sizer,
    routes,
    width: gutter + cardWidth,
    height: Math.max(0, y - schemaMetrics.tableGap),
  }
}
