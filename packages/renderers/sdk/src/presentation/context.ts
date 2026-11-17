// A comparison's changes and the context needed to read them: what a viewer's Changes scope shows.
import type {ChangeStatus, Correspondence, Extraction} from '@githubnext/projections-schemas'
import type {PresentedChanges} from './changes.js'

/** The scopes of a comparison view: every item, the changes and their context, or the noise (items that only varied). */
export type ViewScope = 'all' | 'changes' | 'noise'

/** Every `ViewScope`, in the order a host offers them. */
export const viewScopes: readonly ViewScope[] = ['changes', 'all', 'noise']

/** A row as `changeContext` reads it: a host row, or a presented change (`scopeRows`). */
export interface ScopeRow {
  /** The row's ID: the change's ID, or the item's own for an unchanged one. */
  id: string
  /** Whether the row is an entity or a relationship. */
  collection: 'entities' | 'relationships'
  /** The comparison's status for the row; `unchanged` (or absent) for an item it doesn't mention. */
  status?: ChangeStatus | undefined
  /** How the comparison matched the row's items; anything but `exact` is an identity change. */
  correspondence?: Correspondence | undefined
  /** The row's item IDs in the before extraction. */
  before: readonly string[]
  /** The row's item IDs in the after extraction. */
  after: readonly string[]
}

/** Whether a row is one of a comparison's changes: its status, or its identity (a rename, split or merge), changed. */
export function isScopeChange(row: Pick<ScopeRow, 'status' | 'correspondence'>): boolean {
  return (row.status !== undefined && row.status !== 'unchanged') || (row.correspondence !== undefined && row.correspondence !== 'exact')
}

/** Relationship kinds that place their `to` item inside their `from` item, in every domain schema. */
const sharedContainment = ['contains']
/** Further containment kinds of a domain schema or vocabulary. */
const containmentByName: {readonly [name: string]: readonly string[]} = {
  // A table holds its columns, its primary key and its indexes.
  'database/v0': ['constraint', 'index'],
  // A service holds its registrations, and a registration what it produces (docs/models/dependency-injection-model.md).
  'dependency-injection/v0': ['registration', 'implements'],
}

/**
 * The relationship kinds that mean containment in an extraction (`from` contains `to`): `contains` in every schema,
 * and the containment its domain schema and vocabularies define (a database table's `constraint` and `index`, a
 * dependency-injection service's `registration` and a registration's `implements`).
 */
export function containmentKinds(extraction: Pick<Extraction, 'schema' | 'vocabularies'>): ReadonlySet<string> {
  const names = [extraction.schema, ...(extraction.vocabularies ?? [])]
  return new Set([...sharedContainment, ...names.flatMap(name => containmentByName[name] ?? [])])
}

/** What a Changes scope shows: the changes it is about and the unchanged items that give them context. */
export interface ChangesScope {
  /** The change rows in scope, by row ID. */
  changes: ReadonlySet<string>
  /** The unchanged rows shown to read them: their relationships' endpoints and the items that contain them. */
  context: ReadonlySet<string>
  /** Both: every row the scope shows. */
  shown: ReadonlySet<string>
}

type Side = 'before' | 'after'
const sides: readonly Side[] = ['before', 'after']

/**
 * The context of a comparison's changes, from its structure alone: a changed relationship's endpoints, and the items
 * containing a changed or context entity (`containmentKinds`), with the containment relationships between them, in
 * whichever revision has them. Context is only ever added, and never hides a change. `changes` narrows the changes to
 * those row IDs (for example a find or summary filter's); by default every change (`isScopeChange`) is in scope.
 */
export function changeContext(
  rows: readonly ScopeRow[],
  revisions: {
    before: Pick<Extraction, 'schema' | 'vocabularies' | 'relationships'>
    after: Pick<Extraction, 'schema' | 'vocabularies' | 'relationships'>
  },
  changes?: Iterable<string>,
): ChangesScope {
  const rowOf: Record<Side, Map<string, string>> = {before: new Map(), after: new Map()}
  for (const row of rows) for (const side of sides) for (const id of row[side]) rowOf[side].set(`${row.collection}:${id}`, row.id)
  const ends: Record<Side, Map<string, {from: string; to: string}>> = {before: new Map(), after: new Map()}
  // Each contained entity's containers, with the containment relationship that places it.
  const parents: Record<Side, Map<string, {parent: string; relationship: string}[]>> = {before: new Map(), after: new Map()}
  for (const side of sides) {
    const kinds = containmentKinds(revisions[side])
    for (const relationship of revisions[side].relationships) {
      ends[side].set(relationship.id, relationship)
      if (!kinds.has(relationship.kind)) continue
      const list = parents[side].get(relationship.to) ?? []
      list.push({parent: relationship.from, relationship: relationship.id})
      parents[side].set(relationship.to, list)
    }
  }
  const inScope = changes ? new Set(changes) : undefined
  const changed = new Set(rows.filter(row => (inScope ? inScope.has(row.id) : isScopeChange(row))).map(row => row.id))
  const shown = new Set(changed)
  const visited: Record<Side, Set<string>> = {before: new Set(), after: new Set()}
  const addRow = (side: Side, key: string) => {
    const id = rowOf[side].get(key)
    if (id !== undefined) shown.add(id)
  }
  // An entity and, transitively, what contains it.
  const addEntity = (side: Side, entity: string) => {
    const stack = [entity]
    while (stack.length) {
      const id = stack.pop()!
      if (visited[side].has(id)) continue
      visited[side].add(id)
      addRow(side, `entities:${id}`)
      for (const {parent, relationship} of parents[side].get(id) ?? []) {
        addRow(side, `relationships:${relationship}`)
        stack.push(parent)
      }
    }
  }
  for (const row of rows) {
    if (!changed.has(row.id)) continue
    for (const side of sides)
      for (const id of row[side]) {
        if (row.collection === 'entities') {
          addEntity(side, id)
          continue
        }
        const end = ends[side].get(id)
        if (end) {
          addEntity(side, end.from)
          addEntity(side, end.to)
        }
      }
  }
  return {changes: changed, context: new Set([...shown].filter(id => !changed.has(id))), shown}
}

/** A presented comparison's rows (`presentComparison`) as `changeContext` reads them. */
export function scopeRows(presented: Pick<PresentedChanges, 'entities' | 'relationships'>): ScopeRow[] {
  return (['entities', 'relationships'] as const).flatMap(collection =>
    presented[collection].map(row => ({
      id: row.id,
      collection,
      status: row.status,
      correspondence: row.correspondence,
      before: row.before ? [row.before.id] : [],
      after: row.after ? [row.after.id] : [],
    })),
  )
}
