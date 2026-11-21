import type {ComparisonModel} from '@githubnext/projections-renderer-kit'

/**
 * Rows that depend on `id`: every row with a path of `references`
 * relationships to it, in either revision.
 */
export function dependents(model: ComparisonModel, id: string): Set<string> {
  const referrers = new Map<string, Set<string>>()
  for (const row of model.relationships) {
    for (const [side, relationship] of [
      ['before', row.before],
      ['after', row.after],
    ] as const) {
      if (relationship?.kind !== 'references') continue
      const from = model.entityRow[side].get(relationship.from)
      const to = model.entityRow[side].get(relationship.to)
      if (!from || !to || from === to) continue
      const set = referrers.get(to) ?? new Set<string>()
      set.add(from)
      referrers.set(to, set)
    }
  }
  const found = new Set<string>()
  const next = [id]
  while (next.length) {
    for (const from of referrers.get(next.pop()!) ?? []) {
      if (from !== id && !found.has(from)) {
        found.add(from)
        next.push(from)
      }
    }
  }
  return found
}
