import type {Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {compareIds, statusParts} from '@githubnext/projections-renderer-kit'
import type {ComparisonModel} from '@githubnext/projections-renderer-kit'
import {layoutStates} from './layout.js'
import {schemaMetrics} from './schema.js'
import type {SchemaLayout} from './schema.js'
import {selfLoopRoom} from './links.js'
import type {MeasureText, TextChrome, TextRole, TextArea} from './text.js'
import type {FrameColumn, FrameTable, FrameTag, SchemaFrame} from './frame.js'
import {baseType} from './types.js'
import {analyse} from './diff-states.js'
import type {Analysis} from './diff-states.js'
import {diffLinks} from './diff-links.js'

/**
 * Diff mode: the union of both revisions laid out once, in the renderer's
 * own ERD form, with every change marked in place. Survivors are drawn in
 * their After version and removed entities in their Before version; an
 * enum's card holds the values of both; every relationship of both is
 * linked. A changed column or key takes a row slot under it per change line
 * (`Type changed`, `Made required`…), so nothing overlaps.
 */

/** The diff frame: the union laid out once, every item fully present, and what each tag reads. */
export interface DatabaseDiff {
  frame: SchemaFrame
  layout: SchemaLayout
  /** Tag rows with their Before and After labels, for measuring (see `DatabaseTransition.tagStages`). */
  tagStages: {id: string; label: string}[][]
  tags: EntityChange<Entity>[]
  /** Lines a card draws text in (see text.ts): the lines its header and row heights were counted for. */
  lines: (role: TextRole, text: string, fits: boolean, area?: TextArea) => string[]
}

/** The values a row already shows, so a change line doesn't repeat its new value: a column's name and type, a key's text and name. */
export function shownValues(kind: string, entity: Entity, key?: {text: string; name?: string | undefined}): string[] {
  return kind === 'key' && key ? [key.text, ...(key.name ? [key.name] : [])] : [entity.label, baseType(entity)]
}

/** Row ID of the `index`th change line slot under a row. */
const lineSlot = (id: string, index: number) => `${id}\u0000line:${index}`

/**
 * Gives each change line a row slot under its row, so the card grows and links still meet their own rows; the slot is
 * sized for its word and values like any row (text.ts), leaving out a new value the row already shows.
 */
function addChangeSlots({rows, union, lines}: Analysis) {
  for (const [card, ids] of union.columns) {
    union.columns.set(
      card,
      ids.flatMap(id => {
        const found = lines.get(id) ?? []
        const kind = union.kinds.get(id) ?? 'column'
        const entity = rows.get(id) && (rows.get(id)!.after ?? rows.get(id)!.before)!
        const shown = entity ? shownValues(kind, entity, union.keyRows.get(id)) : []
        found.forEach((line, index) => {
          union.texts.rows.set(lineSlot(id, index), {
            kind: 'change',
            word: line.word,
            before: line.before,
            after: line.after !== undefined && shown.includes(line.after) ? undefined : line.after,
          })
        })
        return [id, ...found.map((_, index) => lineSlot(id, index))]
      }),
    )
  }
}

/** Every card of the union, fully present, with its rows and their change line slots. */
function diffTables({rows, union, state, lines}: Analysis, layout: SchemaLayout): FrameTable[] {
  return union.tables.map(id => {
    const change = rows.get(id)!
    const columns: FrameColumn[] = []
    union.columns.get(id)!.forEach((column, index) => {
      const row = rows.get(column)
      if (!row) return
      const slots = [column, ...(lines.get(column) ?? []).map((_, line) => lineSlot(column, line))].map(
        slot => layout.heights.get(slot) ?? schemaMetrics.row,
      )
      const kind = union.kinds.get(column) ?? 'column'
      const role = union.roles.get(column)
      const marker = kind === 'column' ? union.markers.get(column) : undefined
      const key = kind === 'key' ? union.keyRows.get(column) : undefined
      columns.push({
        change: row,
        kind,
        entity: (row.after ?? row.before)!,
        top: layout.offsets.get(column) ?? schemaMetrics.header + index * schemaMetrics.row,
        // The row and its change line slots.
        height: slots.reduce((sum, value) => sum + value, 0),
        slots,
        opacity: 1,
        ...(role ? {role} : {}),
        ...(marker ? {marker: {...marker, ...(marker.key ? {change: rows.get(marker.key)!} : {})}} : {}),
        ...(key ? {key} : {}),
        ...(lines.has(column) ? {lines: lines.get(column)!} : {}),
      })
    })
    return {
      change,
      entity: state.entities.get(id)!,
      box: layout.tables.get(id)!,
      header: layout.headers.get(id)!,
      status: layout.statuses.get(id) ?? 0,
      opacity: 1,
      columns,
    }
  })
}

/** Tags: entities no card holds, ordered by kind and label. */
function diffTags({rows, union, state}: Analysis) {
  const label = (id: string) => state.entities.get(id)!.label
  const tagIds = [...union.others].sort(
    (a, b) => compareIds(state.entities.get(a)!.kind, state.entities.get(b)!.kind) || compareIds(label(a), label(b)) || compareIds(a, b),
  )
  const tags: FrameTag[] = tagIds.map(id => {
    const row = rows.get(id)!
    const to = (row.after ?? row.before)!.label
    return {change: row, opacity: 1, label: {from: to, to, mix: 1}}
  })
  return {label, tagIds, tags}
}

export function createDatabaseDiff(
  model: ComparisonModel,
  options: {available: number; links?: boolean; measure?: MeasureText; chrome?: TextChrome},
): DatabaseDiff {
  const showLinks = options.links ?? true
  const analysis = analyse(model)
  const {rows, union} = analysis
  addChangeSlots(analysis)
  const layout = layoutStates([union], options.available, showLinks, options.measure, options.chrome, card => {
    const row = rows.get(card)
    return {
      status: row ? statusParts(row).map(part => part.label) : [],
      ...(row?.before && row.after && row.before.label !== row.after.label ? {rename: row.before.label} : {}),
    }
  })[0]!
  const mode = layout.mode
  const tables = diffTables(analysis, layout)
  const links = diffLinks(model, analysis, layout, showLinks)
  const {label, tagIds, tags} = diffTags(analysis)
  const selfLinks = links.some(link => link.dependent === link.principal)
  return {
    frame: {
      mode,
      width: layout.width + (selfLinks && mode === 'columns' ? selfLoopRoom : 0),
      height: layout.height,
      tables,
      links,
      tags,
      stage: {from: 0, to: 0, mix: 0},
    },
    layout,
    tagStages: [
      tagIds.map(id => ({id, label: (rows.get(id)!.before ?? rows.get(id)!.after)!.label})),
      tagIds.map(id => ({id, label: label(id)})),
    ],
    tags: tagIds.map(id => rows.get(id)!),
    lines: (role, text, fits, area) => layout.sizer.lines(role, text, layout.cardWidth, fits, area),
  }
}
