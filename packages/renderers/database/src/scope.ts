import {followContext} from '@githubnext/projections-renderer-kit'
import type {ComparisonModel} from '@githubnext/projections-renderer-kit'

/** Relationships to what a row points at, drawn as a link from it: a key's table and columns, a column's target. */
const ends = new Set(['references', 'constrains', 'foreign-key', 'relation', 'enum-type'])

/**
 * What the Changes scope keeps beside the changes so each can be read: their tables, as the shell does, and what each
 * changed row points at, so its link has both ends. A foreign key whose properties change (its `onDelete`, say) keeps
 * the table it references, its own columns and the columns they reference, with the column link between them, rather
 * than pointing at the fold of unchanged tables; a changed column keeps the column or enum it refers to.
 */
export function databaseContext(all: ComparisonModel, changes: ReadonlySet<string>): Set<string> {
  return followContext(all, changes, {outgoing: kind => ends.has(kind)})
}
