// A comparison's changes and the context needed to read them: what a viewer's Changes scope shows.
import type {ChangeContext, ChangeStatus, Correspondence, Extraction, Relationship} from '@githubnext/projections-schemas'
import type {PresentedChanges} from './changes.js'
import {structuralContext, structureOf, traverse} from './structure.js'
import type {Structure} from './structure.js'

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
  /** The comparison's context for the change (`Change.context`); absent for a comparison saved without it. */
  context?: ChangeContext | undefined
}

/** Whether a row is one of a comparison's changes: its status, or its identity (a rename, split or merge), changed. */
export function isScopeChange(row: Pick<ScopeRow, 'status' | 'correspondence'>): boolean {
  return (row.status !== undefined && row.status !== 'unchanged') || (row.correspondence !== undefined && row.correspondence !== 'exact')
}

/**
 * Containment a domain schema or vocabulary defines beyond `contains`: relationship kinds, or the entity kinds at a
 * relationship's ends whatever its own kind (a vocabulary that names its structure by its entities).
 */
interface Containment {
  kinds?: readonly string[]
  ends?: readonly (readonly [from: string, to: string])[]
}
const containmentByName: Readonly<Record<string, Containment>> = {
  // A table holds its columns, its primary key and its indexes.
  'database/v0': {kinds: ['constraint', 'index']},
  // A service holds its registrations, and a registration the implementation it produces (the vocabulary's structure is
  // its entity kinds; docs/models/dependency-injection-model.md).
  'dependency-injection/v0': {
    ends: [
      ['service', 'registration'],
      ['registration', 'implementation'],
    ],
  },
}

/** The parts of an extraction `isContainment` reads. */
export type ContainmentSource = Pick<Extraction, 'schema' | 'vocabularies' | 'entities' | 'relationships'>

/**
 * Whether a relationship of an extraction means containment (`from` contains `to`): `contains` in every schema, and the
 * containment its domain schema and vocabularies define (a database table's `constraint` and `index`; a
 * dependency-injection service's registrations and a registration's implementation, by their entity kinds).
 */
export function isContainment(extraction: ContainmentSource): (relationship: Relationship) => boolean {
  const rules = [extraction.schema, ...(extraction.vocabularies ?? [])].flatMap(name => containmentByName[name] ?? [])
  const kinds = new Set(['contains', ...rules.flatMap(rule => rule.kinds ?? [])])
  const ends = new Set(rules.flatMap(rule => (rule.ends ?? []).map(([from, to]) => `${from}\n${to}`)))
  const kindOf = ends.size ? new Map(extraction.entities.map(entity => [entity.id, entity.kind])) : undefined
  return relationship =>
    kinds.has(relationship.kind) || Boolean(kindOf && ends.has(`${kindOf.get(relationship.from)}\n${kindOf.get(relationship.to)}`))
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

interface Revisions {
  before: ContainmentSource
  after: ContainmentSource
}

/** A change row's context: the rows that give it context, and the comparator rules that added any. */
export interface RowContext {
  /** The row IDs of its context, in the order found. */
  rows: string[]
  /** The comparator `context` rules that added to it (`ChangeContext.rules`). */
  rules: readonly string[]
  /**
   * Whether it was derived from the comparison's structure because the comparison carries no context at all (one saved
   * before comparisons had context).
   */
  derived: boolean
}

/**
 * The context of each change row of a comparison: the comparison's own (`Change.context`), none for a row it gives
 * none, or, for a comparison saved without any context, the structural derivation the Engine's core context makes (a
 * changed relationship's endpoints, and the items containing a changed or context entity, `isContainment`, with the
 * containment relationships between them). Returns a function from a row to its context.
 */
export function rowContexts(rows: readonly ScopeRow[], revisions: Revisions): (row: ScopeRow) => RowContext {
  const rowOf: Record<Side, Map<string, string>> = {before: new Map(), after: new Map()}
  for (const row of rows) for (const side of sides) for (const id of row[side]) rowOf[side].set(id, row.id)
  let structure: Record<Side, Structure> | undefined
  // A comparison made with context omits it only where the core gave a change none (nothing around it, or the
  // comparison's budget spent), so only a comparison saved without any context is derived.
  const saved = !rows.some(row => row.context)
  return row => {
    const found = new Set<string>()
    const own = new Set([row.id])
    const add = (side: Side, id: string) => {
      const rowId = rowOf[side].get(id)
      if (rowId !== undefined && !own.has(rowId)) found.add(rowId)
    }
    if (row.context) {
      for (const side of sides) for (const id of row.context[side]) add(side, id)
      return {rows: [...found], rules: row.context.rules ?? [], derived: false}
    }
    if (!saved) return {rows: [], rules: [], derived: false}
    structure ??= {before: structureOf(revisions.before), after: structureOf(revisions.after)}
    for (const side of sides) for (const id of structuralContext(structure[side], row, side)) add(side, id)
    return {rows: [...found], rules: [], derived: true}
  }
}

/**
 * The context of a comparison's changes: each change's own (`Change.context`, the Engine's core context and what
 * comparator rules added), else, for a comparison saved without it, the same structural derivation (`rowContexts`).
 * Whatever is shown brings what a renderer needs to place it: a relationship its endpoints, and an entity the items
 * containing it, traversed once for all of them. Context is only ever added, and never hides a change. `changes`
 * narrows the changes to those row IDs (for example a find or summary filter's); by default every change
 * (`isScopeChange`) is in scope.
 */
export function changeContext(rows: readonly ScopeRow[], revisions: Revisions, changes?: Iterable<string>): ChangesScope {
  const inScope = changes ? new Set(changes) : undefined
  const changed = new Set(rows.filter(row => (inScope ? inScope.has(row.id) : isScopeChange(row))).map(row => row.id))
  const shown = new Set(changed)
  if (rows.some(row => row.context)) {
    const contextOf = rowContexts(rows, revisions)
    // A split's or merge's parts share their change's context: it is resolved once.
    const resolved = new Set<object>()
    for (const row of rows) {
      if (!changed.has(row.id) || (row.context && resolved.has(row.context))) continue
      if (row.context) resolved.add(row.context)
      for (const id of contextOf(row).rows) shown.add(id)
    }
  }
  // A comparison saved without context derives it here: the structure around the changes is the core's context.
  const rowOf: Record<Side, Map<string, string>> = {before: new Map(), after: new Map()}
  for (const row of rows) for (const side of sides) for (const id of row[side]) rowOf[side].set(id, row.id)
  const byId = new Map(rows.map(row => [row.id, row]))
  const structure = {before: structureOf(revisions.before), after: structureOf(revisions.after)}
  const reached: Record<Side, Set<string>> = {before: new Set(), after: new Set()}
  // Until nothing new is shown: a row one revision brings is placed in both (a moved containment relationship's
  // endpoints differ between them).
  let pending = [...shown]
  while (pending.length) {
    const next: string[] = []
    for (const side of sides) {
      for (const rowId of pending) {
        for (const id of traverse(structure[side], byId.get(rowId)!, side, reached[side])) {
          const found = rowOf[side].get(id)
          if (found !== undefined && !shown.has(found)) {
            shown.add(found)
            next.push(found)
          }
        }
      }
    }
    pending = next
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
      ...(row.context ? {context: row.context} : {}),
    })),
  )
}
