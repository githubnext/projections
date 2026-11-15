// Diff mode's data (`diffModel`), field changes between two versions, and the standard change marking.

import type {Entity, Relationship} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {classifyChange} from '../emphasis.js'
import type {ChangeClassification} from '../emphasis.js'
import type {ComparisonModel} from '../model.js'
import {fieldChanges} from './fields.js'
import type {FieldChange} from './fields.js'

/**
 * Diff mode's data: the union of both revisions, every entity and
 * relationship once, each with the change the comparison gave it and, for
 * one present on both sides, what differs between its two versions. A diff
 * view lays out this union once, in the renderer's own visual form, and
 * marks each item with its change in place (see `changeMark`). Identity and
 * status come only from the comparison; nothing is matched or inferred here.
 */
export interface DiffModel {
  /** Every entity row once, in the comparison's order. */
  entities: DiffEntity[]
  /** Drawn relationships: one per relationship, or two for one rewired between other endpoints (its old part removed, its new part added). */
  relationships: DiffRelationship[]
  /** How many entities and relationships have each change; a rewired relationship counts once, as its row's change. */
  counts: {entities: DiffCounts; relationships: DiffCounts}
  /** The entity on an entity row ID of the comparison. */
  entity(id: string): DiffEntity | undefined
}

/** One entity of a diff view: its row, its change and, when it is on both sides, what differs. */
export interface DiffEntity {
  /** The comparison's entity row ID, which the host selects by (`data-entity-id`). */
  id: string
  /** The comparison's row, both versions included. */
  row: EntityChange<Entity>
  /** The row's change, from `classifyChange`. */
  change: ChangeClassification
  /** The version to draw: After when it exists, otherwise Before (a removed entity stays as it was). */
  entity: Entity
  /** The Before version; absent for an added entity. */
  before?: Entity
  /** The After version; absent for a removed entity. */
  after?: Entity
  /** What differs between the two versions, label first, then `data` fields by name; empty unless both exist. */
  fields: FieldChange[]
}

/**
 * One drawn relationship of a diff view. A relationship whose endpoints are the same entity rows in both revisions
 * is one part; one rewired between other rows is two, its old part removed and its new part added. A relationship
 * whose endpoint has no entity row is not drawn.
 */
export interface DiffRelationship {
  /** Unique per drawn part: the relationship ID, or `<id>:before` and `<id>:after` for a rewired one (the graph layout's route keys). */
  key: string
  /** The comparison's relationship row ID, shared by both parts of a rewired relationship. */
  id: string
  /** The comparison's relationship row. */
  row: EntityChange<Relationship>
  /** This part's change: a rewired relationship's old part is removed and its new part added. */
  change: ChangeClassification
  /** This part's relationship: After's for a part on both sides or the new part, Before's for the old part. */
  relationship: Relationship
  /** Entity row ID of the source endpoint. */
  from: string
  /** Entity row ID of the target endpoint. */
  to: string
  /** Which revision this part belongs to: both, or only one for an added, removed or rewired part. */
  side: 'both' | 'before' | 'after'
}

/** How many items have each change, every classification present (zero when none). */
export type DiffCounts = Record<ChangeClassification, number>

const emptyCounts = (): DiffCounts => ({added: 0, removed: 0, modified: 0, renamed: 0, unchanged: 0})

/**
 * The union of a comparison for diff mode (see `DiffModel`). In extraction
 * mode every row is unchanged. Entity order is the model's; relationship
 * parts follow their relationship's order, the old part first.
 */
export function diffModel(model: ComparisonModel): DiffModel {
  const entities: DiffEntity[] = model.entities.map(row => ({
    id: row.id,
    row,
    change: classifyChange(row),
    entity: (row.after ?? row.before)!,
    ...(row.before ? {before: row.before} : {}),
    ...(row.after ? {after: row.after} : {}),
    fields: fieldChanges(row.before, row.after),
  }))
  const byId = new Map(entities.map(entity => [entity.id, entity]))
  const relationships: DiffRelationship[] = []
  const counts = {entities: emptyCounts(), relationships: emptyCounts()}
  for (const entity of entities) counts.entities[entity.change]++
  for (const row of model.relationships) {
    const old = row.before && {from: model.entityRow.before.get(row.before.from), to: model.entityRow.before.get(row.before.to)}
    const next = row.after && {from: model.entityRow.after.get(row.after.from), to: model.entityRow.after.get(row.after.to)}
    counts.relationships[classifyChange(row)]++
    const part = (ends: {from: string | undefined; to: string | undefined} | undefined, relationship: Relationship | undefined) =>
      ends?.from !== undefined && ends.to !== undefined && relationship ? {from: ends.from, to: ends.to, relationship} : undefined
    const a = part(old, row.before),
      b = part(next, row.after)
    if (a && b && a.from === b.from && a.to === b.to) {
      relationships.push({key: row.id, id: row.id, row, change: classifyChange(row), ...b, side: 'both'})
      continue
    }
    if (a && b) {
      relationships.push({key: `${row.id}:before`, id: row.id, row, change: 'removed', ...a, side: 'before'})
      relationships.push({key: `${row.id}:after`, id: row.id, row, change: 'added', ...b, side: 'after'})
    } else if (a) relationships.push({key: row.id, id: row.id, row, change: classifyChange(row), ...a, side: 'before'})
    else if (b) relationships.push({key: row.id, id: row.id, row, change: classifyChange(row), ...b, side: 'after'})
  }
  return {entities, relationships, counts, entity: id => byId.get(id)}
}

/**
 * The standard change marking for one item of a diff view: `data-change`
 * with the item's change (`added`, `removed`, `modified` or `renamed`), and
 * nothing for an unchanged one. The kit's styles draw a marked HTML
 * `pk-region` as a fill with a same-hue edge, and a marked SVG item's
 * `pk-diff-shape` (its card or circle) the same way; removed items are
 * dashed and their `pk-diff-text` struck through. Spread it on the element
 * that carries `data-entity-id`.
 */
export function changeMark(change: ChangeClassification | {status: EntityChange<unknown>['status']; renamed?: boolean | undefined}): {
  'data-change'?: Exclude<ChangeClassification, 'unchanged'>
} {
  const classified = typeof change === 'string' ? change : classifyChange(change)
  return classified === 'unchanged' ? {} : {'data-change': classified}
}
