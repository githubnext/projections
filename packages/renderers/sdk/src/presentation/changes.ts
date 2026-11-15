// Comparison changes paired into per-item before and after rows.
import type {ChangeStatus, Comparison, Correspondence, Entity, Extraction, Relationship, Varied} from '@githubnext/projections-schemas'
import {presentOrder} from '../steps.js'
import type {PresentedOrder} from '../steps.js'

/**
 * One entity or relationship as presented: its before and after items paired
 * by the comparison. This is presentation state, not a protocol document.
 */
export interface EntityChange<T> {
  /**
   * The row's stable ID: the comparison change's ID, or the item's own ID for an item the comparison doesn't mention
   * and for the further parts of a split or merge (suffixed `~1`, `~2`… only if that collides).
   */
  id: string
  /** The item in the `before` extraction; absent for an addition and a further split part. */
  before?: T
  /** The item in the `after` extraction; absent for a removal and a further merged part. */
  after?: T
  /** The comparison's status for the item; `unchanged` for items it doesn't mention and in a snapshot. */
  status: ChangeStatus
  /** How the comparison matched `before` to `after`; absent in a snapshot (`snapshotChanges`). */
  correspondence?: Correspondence
  /** True when the item kept its identity under another ID (a `declared`, `split` or `merge` correspondence). */
  renamed?: boolean
  /** The `before` item's ID when `renamed`, for showing what it was called. */
  previousId?: string
  /**
   * The comparison's `change.varied`: volatile values that differ between the
   * two sides, each within its tolerance or beyond it. An `unchanged` row with
   * `varied` varied only within tolerance and is presented as unchanged; a
   * `modified` one with a value beyond tolerance carries the volatile marker
   * (`variedBeyond`).
   */
  varied?: readonly Varied[]
}

/**
 * Comparison changes expanded into per-item before/after pairs for
 * presentation, with the comparison's steps resolved to those rows (absent
 * only when a caller builds the pairs by hand).
 */
export interface PresentedChanges extends Partial<PresentedOrder> {
  /** One row per entity, in ID order. */
  entities: EntityChange<Entity>[]
  /** One row per relationship, in ID order. */
  relationships: EntityChange<Relationship>[]
}
/** Rows for a single extraction's items: each `unchanged`, with only `after`, under its own ID, in the given order. */
export function snapshotChanges<T extends {id: string}>(entities: readonly T[]): EntityChange<T>[] {
  return entities.map(entity => ({id: entity.id, after: entity, status: 'unchanged'}))
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Pairs the before and after items of a comparator-produced comparison. Items a
 * comparison does not mention are unchanged under their own ID. Identity comes
 * exclusively from the comparison; nothing is inferred here.
 */
export function presentComparison(before: Extraction, after: Extraction, comparison: Comparison): PresentedChanges {
  const present = <T extends Entity | Relationship>(collection: 'entities' | 'relationships', old: readonly T[], current: readonly T[]) => {
    const oldById = new Map(old.map(item => [item.id, item]))
    const currentById = new Map(current.map(item => [item.id, item]))
    const lookup = <V>(map: Map<string, V>, id: string): V => {
      const item = map.get(id)
      if (!item) throw new Error(`Comparison references unknown ${collection} item ${id}`)
      return item
    }
    const rows: EntityChange<T>[] = []
    const referenced = {before: new Set<string>(), after: new Set<string>()}
    const ids = new Set<string>()
    const unique = (id: string) => {
      let candidate = id
      for (let suffix = 1; ids.has(candidate); suffix++) candidate = `${id}~${suffix}`
      ids.add(candidate)
      return candidate
    }
    const changes = comparison.changes.filter(change => change.collection === collection)
    for (const change of changes) ids.add(change.id)
    for (const change of changes) {
      for (const id of change.before) referenced.before.add(id)
      for (const id of change.after) referenced.after.add(id)
      const [first, ...others] = change.after
      const [prior, ...merged] = change.before
      const renamed = change.correspondence !== 'exact' && change.correspondence !== 'none'
      rows.push({
        id: change.id,
        status: change.status,
        correspondence: change.correspondence,
        ...(prior === undefined ? {} : {before: lookup(oldById, prior)}),
        ...(first === undefined ? {} : {after: lookup(currentById, first)}),
        ...(renamed ? {renamed: true} : {}),
        ...(renamed && prior !== undefined ? {previousId: prior} : {}),
        ...(change.varied?.length ? {varied: change.varied} : {}),
      })
      // Further split parts arrive, and further merged parts leave, on their own.
      for (const id of others)
        rows.push({id: unique(id), after: lookup(currentById, id), status: change.status, correspondence: change.correspondence})
      for (const id of merged)
        rows.push({id: unique(id), before: lookup(oldById, id), status: change.status, correspondence: change.correspondence})
    }
    for (const item of current) {
      if (referenced.after.has(item.id)) continue
      const prior = oldById.get(item.id)
      if (!prior || referenced.before.has(item.id)) throw new Error(`Comparison omits ${collection} item ${item.id}`)
      rows.push({id: unique(item.id), before: prior, after: item, status: 'unchanged', correspondence: 'exact'})
    }
    return rows.sort((a, b) => compareIds(a.id, b.id))
  }
  const rows = {
    entities: present('entities', before.entities, after.entities),
    relationships: present('relationships', before.relationships, after.relationships),
  }
  return {...rows, ...presentOrder(rows, comparison)}
}
