import {followContext, type ComparisonModel} from '@githubnext/projections-renderer-kit'

/** Relationships to what a row points at, drawn as a link from it: a key's table and columns, a column's target. */
const ends = new Set(['references', 'constrains', 'foreign-key', 'relation', 'enum-type'])

/**
 * What the Changes scope keeps beside the changes so each can be read: their tables, as the shell does, and what each
 * changed row points at, so its link has both ends. A foreign key whose properties change (its `onDelete`, say) keeps
 * the table it references, its own columns and the columns they reference, with the column link between them, rather
 * than pointing at the fold of unchanged tables; a changed column keeps the column or enum it refers to. Each kept
 * column keeps the table that holds it.
 */
export function databaseContext(all: ComparisonModel, changes: ReadonlySet<string>): Set<string> {
  const found = followContext(all, changes, {outgoing: kind => ends.has(kind)})
  // The shell places its own context in its containers, not this: a reached column brings its table (and whatever
  // holds that), with the containment between them, in either revision.
  for (let added = true; added;) {
    added = false
    for (const row of all.relationships) {
      for (const side of ['before', 'after'] as const) {
        const item = row[side]
        if (item?.kind !== 'contains') continue
        const from = all.entityRow[side].get(item.from),
          to = all.entityRow[side].get(item.to)
        if (from === undefined || to === undefined || !found.has(to) || found.has(from)) continue
        found.add(from).add(row.id)
        added = true
      }
    }
  }
  return found
}
