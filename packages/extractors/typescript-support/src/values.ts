import type {Extraction} from './types.js'
import {record} from './shared.js'

export const compareIds = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)

/** Stable domain-value identity spelling, not extraction canonicalization or hashing. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).toSorted(([a], [b]) => compareIds(a, b)))
      : item,
  )
}

/** Check only the exported transport envelope; the required runner engine validates every item. */
export function exportedExtraction(value: unknown): Extraction {
  const extraction = record(value, 'Exported extraction')
  if (
    extraction.protocolVersion !== 0 ||
    typeof extraction.schema !== 'string' ||
    !Array.isArray(extraction.entities) ||
    !Array.isArray(extraction.relationships)
  ) {
    throw new Error('Exported extraction must have protocolVersion 0, schema, entities and relationships')
  }
  for (const entity of [...extraction.entities, ...extraction.relationships]) {
    const item = record(entity, 'Exported item')
    if (
      typeof item.id !== 'string' ||
      typeof item.kind !== 'string' ||
      (item.data !== undefined && (item.data === null || typeof item.data !== 'object' || Array.isArray(item.data)))
    ) {
      throw new Error('Exported item requires id, kind and optional object data')
    }
  }
  return value as Extraction
}
