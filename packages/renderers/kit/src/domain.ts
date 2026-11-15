import type {Entity, Relationship} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import type {ComparisonModel} from './model.js'
import {entityPresence} from './emphasis.js'

/**
 * A comparison indexed for domain renderers (from `useDomainIndex`): rows keyed by identity, and relationship rows
 * resolved to the entity rows they join, through whichever revision has the relationship (the later one when both do).
 */
export interface DomainIndex {
  /** Every entity row. */
  changes: EntityChange<Entity>[]
  /** Rows a viewer can currently see: included and present at this progress. */
  visible: EntityChange<Entity>[]
  /** Maps an entity ID of either extraction to its row. */
  changeOf: Map<string, EntityChange<Entity>>
  /** Relationship rows from both extractions, so a dropped relationship still animates out. */
  edges: EntityChange<Relationship>[]
  /** Relationships leaving each entity row, keyed by entity row ID; a row with none has no key. */
  out: Map<string, EntityChange<Relationship>[]>
  /** Relationships arriving at each entity row, keyed by entity row ID; a row with none has no key. */
  into: Map<string, EntityChange<Relationship>[]>
}

/** Entity and relationship rows keyed by identity, with relationships resolved to entity rows. */
export function domainIndex(model: ComparisonModel): Omit<DomainIndex, 'visible'> {
  const changeOf = new Map<string, EntityChange<Entity>>()
  const byRow = new Map(model.entities.map(row => [row.id, row]))
  for (const [id, row] of model.entityRow.before) changeOf.set(id, byRow.get(row)!)
  for (const [id, row] of model.entityRow.after) changeOf.set(id, byRow.get(row)!)
  const out = new Map<string, EntityChange<Relationship>[]>()
  const into = new Map<string, EntityChange<Relationship>[]>()
  for (const edge of model.relationships) {
    const after = Boolean(edge.after)
    const side = edge.after ?? edge.before!
    const rows = after ? model.entityRow.after : model.entityRow.before
    const source = rows.get(side.from),
      target = rows.get(side.to)
    if (source) (out.get(source) ?? out.set(source, []).get(source)!).push(edge)
    if (target) (into.get(target) ?? into.set(target, []).get(target)!).push(edge)
  }
  return {changes: model.entities, edges: model.relationships, changeOf, out, into}
}
