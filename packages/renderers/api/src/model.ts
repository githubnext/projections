import type {Entity, Extraction} from '@githubnext/projections-schemas'
import {compareIds, type ChangesScope, type ComparisonModel, type Folded} from '@githubnext/projections-renderer-kit'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import type {Side} from './signature.js'

export const declarationLimit = 500

/** Declarations one revision exports, in its own ID order, so each side lists exactly what its extraction alone would. */
export function revisionRows(model: ComparisonModel, side: Side): EntityChange<Entity>[] {
  return model.entities.filter(row => row[side]).sort((a, b) => compareIds(a[side]!.id, b[side]!.id))
}

/** Every declaration of a comparison, removed ones included, in ID order. */
export function comparisonRows(model: ComparisonModel): EntityChange<Entity>[] {
  return [...model.entities].sort((a, b) => compareIds(a.id, b.id))
}

/**
 * A diff's rows with its changes first when they don't all fit under `limit`, each group in its own order, so the
 * limit cuts unchanged declarations rather than changed ones. Rows that fit keep their order.
 */
export function changesFirst<T extends {status: string}>(rows: readonly T[], limit: number): T[] {
  if (rows.length <= limit) return [...rows]
  return [...rows.filter(row => row.status !== 'unchanged'), ...rows.filter(row => row.status === 'unchanged')]
}

/**
 * The Changes scope with at most `limit` of `rows` shown: its changes first, then their context, each in list order, so
 * the limit folds context rather than changes. Within the limit, the scope as it is.
 */
export function limitScope(scope: ChangesScope, rows: readonly {id: string}[], limit: number): ChangesScope {
  const listed = rows.filter(row => scope.shown.has(row.id))
  if (listed.length <= limit) return scope
  const kept = [...listed.filter(row => scope.changes.has(row.id)), ...listed.filter(row => !scope.changes.has(row.id))].slice(0, limit)
  const shown = new Set(kept.map(row => row.id))
  const within = (ids: ReadonlySet<string>) => new Set([...ids].filter(id => shown.has(id)))
  return {changes: within(scope.changes), context: within(scope.context), shown}
}

/** An ID as people read it: extractors percent-encode the IDs nested in it (`ts-api%3A(root)` is `ts-api:(root)`). */
export function readableId(id: string): string {
  let text = id
  for (let depth = 0; depth < 8 && /%[0-9A-F]{2}/iu.test(text); depth++) {
    try {
      text = decodeURIComponent(text)
    } catch {
      break
    }
  }
  return text
}

/**
 * Each declaration's name as code would spell it: the labels of the declarations that contain it and its own, joined
 * with `.` (`Response.headers`), from one extraction's `contains` relationships. Where two declarations would share a
 * name (the same export from two entry points), each is named by its readable ID instead.
 */
export function qualifiedNames(extraction: Extraction): Map<string, string> {
  const labels = new Map(extraction.entities.map(entity => [entity.id, entity.label]))
  const parent = new Map<string, string>()
  for (const relationship of extraction.relationships) {
    if (relationship.kind === 'contains' && labels.has(relationship.from)) parent.set(relationship.to, relationship.from)
  }
  const names = new Map<string, string>()
  for (const {id, label} of extraction.entities) {
    const parts = [label]
    const seen = new Set([id])
    for (let up = parent.get(id); up !== undefined && !seen.has(up); up = parent.get(up)) {
      seen.add(up)
      parts.unshift(labels.get(up)!)
    }
    names.set(id, parts.join('.'))
  }
  const counts = new Map<string, number>()
  for (const name of names.values()) counts.set(name, (counts.get(name) ?? 0) + 1)
  for (const [id, name] of names) if (counts.get(name)! > 1) names.set(id, readableId(id))
  return names
}

/**
 * A folded list drawn with at most `limit` declarations: entries in order until the limit, counting a fold's opened run
 * and any declaration outside a fold; then nothing more. Also how many it draws and would draw.
 */
export function limitEntries<T>(entries: readonly Folded<T>[], limit: number): {entries: Folded<T>[]; drawn: number; total: number} {
  const kept: Folded<T>[] = []
  let drawn = 0,
    total = 0
  for (const entry of entries) {
    if (entry.type !== 'item') {
      if (drawn < limit) kept.push(entry)
      continue
    }
    total++
    if (drawn >= limit) continue
    kept.push(entry)
    drawn++
  }
  return {entries: kept, drawn, total}
}
