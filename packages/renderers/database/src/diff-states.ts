import type {Entity, Relationship} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {sameValue, type ComparisonModel} from '@githubnext/projections-renderer-kit'
import {buildModel} from './schema-model.js'
import {enumValues, isEnum} from './vocabulary.js'
import type {SchemaModel, SchemaState} from './schema.js'
import {columnChanges, keyChanges, markerChanges, both, type ChangeLine} from './change-lines.js'

/** An enum's values in both revisions: After's order, each removed value after the value it followed in Before. */
export function mergeValues(before: readonly string[], after: readonly string[]): string[] {
  const result = [...after]
  let at = 0
  for (const value of before) {
    const index = result.indexOf(value)
    if (index >= 0) at = index + 1
    else result.splice(at++, 0, value)
  }
  return result
}

export interface DiffStates {
  before: SchemaState
  after: SchemaState
  union: SchemaState
}

/** Both revisions and their union, in presented row IDs. */
export function diffStates(model: ComparisonModel): DiffStates {
  const edge = (relationship: Relationship, side: 'before' | 'after', id: string) => {
    const from = model.entityRow[side].get(relationship.from),
      to = model.entityRow[side].get(relationship.to)
    return from === undefined || to === undefined ? undefined : {id, kind: relationship.kind, from, to, data: relationship.data}
  }
  type Edge = NonNullable<ReturnType<typeof edge>>
  const edges = (side: 'before' | 'after') =>
    model.relationships.flatMap(row => {
      const version = row[side]
      const found = version && edge(version, side, row.id)
      return found ? [found] : []
    })
  const before = edges('before'),
    after = edges('after')
  const same = (a: Edge, b: Edge) => a.kind === b.kind && a.from === b.from && a.to === b.to && sameValue(a.data, b.data)
  // After's relationships first, so a column or key that moved belongs to its new table; then Before's that differ.
  const union = [...after, ...before.filter(old => !after.some(next => next.id === old.id && same(old, next)))]
  const entities = (pick: (row: EntityChange<Entity>) => Entity | undefined) =>
    new Map(model.entities.flatMap(row => (pick(row) ? [[row.id, pick(row)!] as const] : [])))
  return {
    before: {entities: entities(row => row.before), relationships: before},
    after: {entities: entities(row => row.after), relationships: after},
    union: {
      entities: entities(row => {
        const entity = row.after ?? row.before
        if (!row.before || !row.after || !isEnum(entity)) return entity
        return {...entity!, data: {...entity!.data, values: mergeValues(enumValues(row.before), enumValues(row.after))}}
      }),
      relationships: union,
    },
  }
}

export interface Analysis {
  rows: Map<string, EntityChange<Entity>>
  before: SchemaModel
  after: SchemaModel
  union: SchemaModel
  state: SchemaState
  /** The card that holds each row (column, key, marker constraint or enum value). */
  owner: Map<string, string>
  /** Each changed column's or key's change lines. */
  lines: Map<string, ChangeLine[]>
}

export function analyse(model: ComparisonModel): Analysis {
  const states = diffStates(model)
  const before = buildModel(states.before),
    after = buildModel(states.after),
    union = buildModel(states.union)
  // A link both revisions draw is After's (a relationship replaced by another on the same columns reads as kept).
  const afterLinks = new Map(after.links.map(link => [link.key, link]))
  union.links = union.links.map(link => afterLinks.get(link.key) ?? link)
  const rows = new Map(model.entities.map(row => [row.id, row]))
  for (const [id, value] of union.values) {
    const entity: Entity = {id, kind: 'enum-value', label: value}
    const was = before.values.has(id),
      now = after.values.has(id)
    rows.set(id, {
      id,
      status: was && now ? 'unchanged' : was ? 'removed' : 'added',
      ...(was ? {before: entity} : {}),
      ...(now ? {after: entity} : {}),
    })
  }
  const owner = new Map<string, string>()
  const lines = new Map<string, ChangeLine[]>()
  for (const [card, ids] of union.columns) {
    for (const id of ids) {
      owner.set(id, card)
      const row = rows.get(id)
      const kind = union.kinds.get(id) ?? 'column'
      if (!row || !both(row) || kind === 'value') continue
      const found = kind === 'key' ? keyChanges(row) : columnChanges(row)
      if (found.length) lines.set(id, found)
    }
  }
  for (const [column, marker] of union.markers) {
    if (!marker.key || !owner.has(column)) continue
    owner.set(marker.key, owner.get(column)!)
    // The key the marker stands for has no row of its own: its changes are said under its column, named for that key
    // (its PK or FK label; the marker's title names every role the column has).
    const key = rows.get(marker.key)
    const found = key && both(key) ? markerChanges(key, marker.label === 'PK' ? 'Primary key' : 'Foreign key') : []
    if (found.length) lines.set(column, [...(lines.get(column) ?? []), ...found])
  }
  return {rows, before, after, union, state: states.union, owner, lines}
}
