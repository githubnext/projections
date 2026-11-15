import {compareIds} from '@githubnext/projections-renderer-kit'
import type {TextSizer} from './text.js'
import {anchor, cardHeight, keepOrder, orderRanks, rowGeometry} from './geometry.js'
import type {Geometry} from './geometry.js'
import {schemaMetrics} from './schema.js'
import type {SchemaBox, SchemaLayout, SchemaLink, SchemaModel, SchemaPoint} from './schema.js'

/** A long link's slot in a rank it crosses, from the dependent's rank to the principal's. */
type Waypoints = Map<string, {rank: number; y: number}[]>

/** What placing one rank reads and writes: the cards placed so far and the crossing links' slots. */
interface Placement {
  model: SchemaModel
  geometry: Geometry
  cardWidth: number
  later: ReadonlyMap<string, number> | undefined
  tables: Map<string, SchemaBox>
  waypoints: Waypoints
}

/** Where a link's route stands in the rank before this one: its slot there, or the principal row it leaves from. */
const previousY = ({geometry, tables, waypoints}: Placement, link: SchemaLink, rank: number) =>
  waypoints.get(link.key)?.find(point => point.rank === rank - 1)?.y ??
  anchor(geometry, tables.get(link.principal)!, link.principal, link.principalColumn)

/** Places one rank's cards near the rows they reference, in that order, without overlapping; returns the runs they take. */
function placeRank(placement: Placement, cards: readonly string[], rank: number): [number, number][] {
  const {model, geometry, cardWidth, later, tables} = placement
  const {rankGap, tableGap, clearance} = schemaMetrics
  const placed = cards.map(table => {
    const pulls = model.links
      .filter(link => link.dependent === table && model.rank.get(link.principal)! < rank)
      .map(link => previousY(placement, link, rank) - anchor(geometry, {x: 0, y: 0, width: 0, height: 0}, table, link.dependentColumn))
    return {
      id: table,
      height: cardHeight(model, table, geometry),
      desired: pulls.length ? pulls.reduce((sum, value) => sum + value, 0) / pulls.length : NaN,
    }
  })
  // Cards settle near the rows they reference, in that order, without overlapping.
  const settled = (value: number) => (Number.isNaN(value) ? Infinity : value)
  placed.sort((a, b) => settled(a.desired) - settled(b.desired) || cards.indexOf(a.id) - cards.indexOf(b.id))
  const order = keepOrder(
    placed.map(card => card.id),
    later,
  )
  placed.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
  let cursor = 0
  const occupied: [number, number][] = []
  for (const card of placed) {
    const y = Number.isNaN(card.desired) ? cursor : Math.max(cursor, card.desired)
    tables.set(card.id, {x: rank * (cardWidth + rankGap), y, width: cardWidth, height: card.height})
    occupied.push([y - clearance, y + card.height + clearance])
    cursor = y + card.height + tableGap
  }
  return occupied
}

/** A link crossing this rank takes the nearest free run: above the cards, between two, or below. */
function slotCrossings(placement: Placement, crossing: readonly SchemaLink[], rank: number, occupied: [number, number][]) {
  const {waypoint} = schemaMetrics
  const passing = crossing
    .map(link => ({link, desired: previousY(placement, link, rank)}))
    .sort((a, b) => a.desired - b.desired || compareIds(a.link.key, b.link.key))
  for (const {link, desired} of passing) {
    occupied.sort((a, b) => a[0] - b[0])
    const half = waypoint / 2
    let best = NaN
    const consider = (low: number, high: number) => {
      if (high - low < waypoint) return
      const center = Math.max(low + half, Math.min(high - half, desired))
      if (Number.isNaN(best) || Math.abs(center - desired) < Math.abs(best - desired)) best = center
    }
    consider(-Infinity, occupied[0]?.[0] ?? Infinity)
    for (let index = 0; index < occupied.length; index++) consider(occupied[index]![1], occupied[index + 1]?.[0] ?? Infinity)
    occupied.push([best - half, best + half])
    placement.waypoints.set(link.key, [...(placement.waypoints.get(link.key) ?? []), {rank, y: best}])
  }
}

export function columnsLayout(model: SchemaModel, cardWidth: number, sizer: TextSizer, later?: ReadonlyMap<string, number>): SchemaLayout {
  const {rankGap, waypoint} = schemaMetrics
  const geometry = rowGeometry(model, cardWidth, sizer)
  const ranks = orderRanks(model, later)
  const x = (rank: number) => rank * (cardWidth + rankGap)
  const tables = new Map<string, SchemaBox>()
  const rows = new Map<string, number>()
  for (const table of model.tables) model.columns.get(table)!.forEach((column, index) => rows.set(column, index))
  const routes = new Map<string, SchemaPoint[]>()
  const waypoints: Waypoints = new Map()
  // Long links reserve a slot in every rank they cross, so they never pass through a card.
  const crossings: {link: SchemaLink; rank: number}[] = []
  for (const link of model.links) {
    const from = model.rank.get(link.dependent)!
    const to = model.rank.get(link.principal)!
    for (let rank = from - 1; rank > to; rank--) crossings.push({link, rank})
  }
  const placement: Placement = {model, geometry, cardWidth, later, tables, waypoints}
  for (let rank = 0; rank < ranks.length; rank++) {
    const occupied = placeRank(placement, ranks[rank]!, rank)
    const crossing = crossings.filter(item => item.rank === rank).map(({link}) => link)
    slotCrossings(placement, crossing, rank, occupied)
  }
  // Runs above the first card may be negative; shift the whole layout so it starts at zero.
  const top = Math.min(0, ...[...tables.values()].map(box => box.y), ...[...waypoints.values()].flat().map(point => point.y - waypoint / 2))
  for (const box of tables.values()) box.y -= top
  for (const points of waypoints.values()) for (const point of points) point.y -= top
  for (const link of model.links) {
    const points = (waypoints.get(link.key) ?? [])
      .sort((a, b) => b.rank - a.rank)
      .flatMap(point => [
        {x: x(point.rank) + cardWidth, y: point.y},
        {x: x(point.rank), y: point.y},
      ])
    routes.set(link.key, points)
  }
  const boxes = [...tables.values()]
  const bottoms = [...boxes.map(box => box.y + box.height), ...[...waypoints.values()].flat().map(point => point.y + waypoint / 2)]
  return {
    mode: 'columns',
    cardWidth,
    tables,
    rows,
    ...geometry,
    sizer,
    routes,
    width: boxes.length ? Math.max(...boxes.map(box => box.x + box.width)) : 0,
    height: bottoms.length ? Math.max(...bottoms) : 0,
  }
}
