import type {Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {current, type StagedTimeline} from '@githubnext/projections-renderer-kit'
import {schemaMetrics, type SchemaBox, type SchemaLayout, type SchemaModel, type SchemaState} from './schema.js'
import {lerp, lerpBox, longestIncreasing, smooth, VISIBLE} from './fading.js'
import type {FrameColumn, FrameTable, FrameTag, SchemaFrame} from './frame.js'
import type {LinkShape} from './links.js'
import {columnKey, type fades} from './stages.js'

/** Everything a frame is interpolated from: the stages, their layouts and drawings, and every item's fade. */
export interface Staged extends ReturnType<typeof fades> {
  timeline: StagedTimeline
  rows: Map<string, EntityChange<Entity>>
  states: SchemaState[]
  models: SchemaModel[]
  layouts: SchemaLayout[]
  owner: Map<string, string>
  last: number
  mode: SchemaLayout['mode']
  shapes: Map<string, (LinkShape | undefined)[]>
  tagIds: string[]
  tagFade: Map<string, (t: number) => number>
}

export type Stage = SchemaFrame['stage']

/** Where something that exists in neither stage of a frame was last (or will next be) laid out. */
export function nearest<T>({last}: Staged, from: number, pick: (stage: number) => T | undefined): T | undefined {
  const inRange = (stage: number) => stage >= 0 && stage <= last
  for (let offset = 0; offset <= last; offset++) {
    const value = (inRange(from - offset) ? pick(from - offset) : undefined) ?? (inRange(from + offset) ? pick(from + offset) : undefined)
    if (value !== undefined) return value
  }
  return undefined
}

/** Where the frame's cards and rows are: each card's box and header, each row's top and opacity. */
export interface Placed {
  boxes: Map<string, SchemaBox>
  tops: Map<string, number>
  headers: Map<string, number>
  columnOpacity: Map<string, number>
}

/** A card's rows at this frame; rows that change order fade out, the others close and open gaps, then they fade in. */
function frameColumns(
  staged: Staged,
  id: string,
  t: number,
  {from, to, mix}: Stage,
  card: {header: number; height: number},
  placed: Placed,
): FrameColumn[] {
  const {header} = card
  const {models, layouts, rows, columnFade, timeline, owner} = staged
  const pick = <T>(of: (stage: SchemaModel) => T | undefined) =>
    mix < 0.5 ? (of(models[from]!) ?? of(models[to]!)) : (of(models[to]!) ?? of(models[from]!))
  const before = models[from]!.columns.get(id) ?? [],
    after = models[to]!.columns.get(id) ?? []
  const columnIds = [...new Set([...after, ...before])]
  // Rows that change order (a column that becomes a key moves up) would slide through
  // their neighbours; they fade out, the others close and open gaps, then they fade in.
  const survivors = before.filter(column => after.includes(column))
  const sliding = longestIncreasing(survivors.map(column => after.indexOf(column)))
  const jumpers = new Set(survivors.filter((_, index) => !sliding.has(index)))
  const slide = jumpers.size ? smooth((mix - 0.25) / 0.5) : mix
  const columns: FrameColumn[] = []
  for (const column of columnIds) {
    const jumper = jumpers.has(column)
    // Rows aren't all one height (a row grows to show its text whole): place them by their offsets in each stage.
    const a = layouts[from]!.offsets.get(column),
      b = layouts[to]!.offsets.get(column)
    const top = a !== undefined && b !== undefined ? (jumper ? (mix < 0.5 ? a : b) : lerp(a, b, slide)) : (b ?? a ?? header)
    placed.tops.set(column, top)
    const ha = layouts[from]!.heights.get(column),
      hb = layouts[to]!.heights.get(column)
    const height = ha !== undefined && hb !== undefined ? lerp(ha, hb, mix) : (hb ?? ha ?? schemaMetrics.row)
    // A row only one stage has is never more present than its card has room for it, so it never shows clipped.
    const room = a !== undefined && b !== undefined ? 1 : Math.max(0, Math.min(1, (card.height - top) / height))
    const rowOpacity =
      columnFade.get(columnKey(id, column))!(t) * room * (!jumper ? 1 : mix < 0.5 ? 1 - smooth(mix / 0.25) : smooth((mix - 0.75) / 0.25))
    placed.columnOpacity.set(column, rowOpacity)
    if (rowOpacity <= VISIBLE) continue
    const row = rows.get(column)!
    const columnRole = pick(stage => stage.roles.get(column))
    const kind = pick(stage => stage.kinds.get(column)) ?? 'column'
    const marker = kind === 'column' ? pick(stage => stage.markers.get(column)) : undefined
    const key = kind === 'key' ? pick(stage => stage.keyRows.get(column)) : undefined
    columns.push({
      change: row,
      kind,
      entity: current(row, timeline.local(owner.get(column) ?? column, t)),
      top,
      height,
      opacity: rowOpacity,
      ...(columnRole ? {role: columnRole} : {}),
      ...(marker ? {marker: {...marker, ...(marker.key ? {change: rows.get(marker.key)!} : {})}} : {}),
      ...(key ? {key} : {}),
    })
  }
  return columns
}

/** Every visible card at this frame, between its two stages' boxes, with its rows. */
export function frameTables(staged: Staged, t: number, stage: Stage, placed: Placed): FrameTable[] {
  const {layouts, rows, tableIds, tableFade, timeline} = staged
  const {from, to, mix} = stage
  const tables: FrameTable[] = []
  for (const id of tableIds) {
    const a = layouts[from]!.tables.get(id),
      b = layouts[to]!.tables.get(id)
    const box = a && b ? lerpBox(a, b, mix) : (a ?? b ?? nearest(staged, from, index => layouts[index]!.tables.get(id))!)
    placed.boxes.set(id, box)
    const ha = layouts[from]!.headers.get(id),
      hb = layouts[to]!.headers.get(id)
    const header =
      ha !== undefined && hb !== undefined
        ? lerp(ha, hb, mix)
        : (ha ?? hb ?? nearest(staged, from, index => layouts[index]!.headers.get(id)) ?? schemaMetrics.header)
    placed.headers.set(id, header)
    const opacity = tableFade.get(id)!(t)
    if (opacity <= VISIBLE) continue
    const change = rows.get(id)!
    const columns = frameColumns(staged, id, t, stage, {header, height: box.height}, placed)
    const status = layouts[to]!.statuses.get(id) ?? layouts[from]!.statuses.get(id) ?? 0
    tables.push({change, entity: current(change, timeline.local(id, t)), box, header, status, opacity, columns})
  }
  return tables
}

/** Every visible tag at this frame, its label blending between the two stages'. */
export function frameTags({tagIds, tagFade, states, rows}: Staged, t: number, {from, to, mix}: Stage): FrameTag[] {
  const tags: FrameTag[] = []
  for (const id of tagIds) {
    const opacity = tagFade.get(id)!(t)
    if (opacity <= VISIBLE) continue
    const label = (stage: number) => states[stage]!.entities.get(id)?.label
    const a = label(from),
      b = label(to)
    tags.push({change: rows.get(id)!, opacity, label: {from: a ?? b!, to: b ?? a!, mix: a !== undefined && b !== undefined ? mix : 0}})
  }
  return tags
}
