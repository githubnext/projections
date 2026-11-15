import type {Entity, Extraction} from '@githubnext/projections-schemas'
import {compareIds} from '@githubnext/projections-renderer-kit'
import type {ComparisonModel} from '@githubnext/projections-renderer-kit'
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

/** An ID as people read it: extractors percent-encode the IDs nested in it (`ts-api%3A(root)` is `ts-api:(root)`). */
export function readableId(id: string): string {
  let text = id
  for (let depth = 0; depth < 8 && /%[0-9A-Fa-f]{2}/.test(text); depth++) {
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
  for (const relationship of extraction.relationships)
    if (relationship.kind === 'contains' && labels.has(relationship.from)) parent.set(relationship.to, relationship.from)
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
