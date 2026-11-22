// A revision's structure, as the Changes scope derives context from it for a comparison saved without context: the
// same structural context the Engine's core context makes.
import {isContainment, type ContainmentSource} from './containment.js'
import type {ScopeRow} from './context.js'

type Side = 'before' | 'after'

/** One revision's structure, indexed for context: each relationship's endpoints, and each contained entity's containers. */
export interface Structure {
  ends: Map<string, {from: string; to: string}>
  parents: Map<string, {parent: string; relationship: string}[]>
}

export function structureOf(revision: ContainmentSource): Structure {
  const contains = isContainment(revision)
  const ends = new Map<string, {from: string; to: string}>()
  const parents = new Map<string, {parent: string; relationship: string}[]>()
  for (const relationship of revision.relationships) {
    ends.set(relationship.id, relationship)
    if (!contains(relationship)) continue
    const list = parents.get(relationship.to) ?? []
    list.push({parent: relationship.from, relationship: relationship.id})
    parents.set(relationship.to, list)
  }
  return {ends, parents}
}

/**
 * Adds a row's structural context in one revision, as item IDs, to `found`: what the Engine's core context holds, with
 * the row's own items. Items already in `found` aren't traversed again, so several rows can share one traversal.
 * Returns the IDs it added.
 */
export function traverse(structure: Structure, row: ScopeRow, side: Side, found: Set<string>): string[] {
  const added: string[] = []
  const add = (id: string) => {
    if (!found.has(id)) {
      found.add(id)
      added.push(id)
    }
  }
  const stack: string[] = []
  for (const id of row[side]) {
    if (row.collection === 'entities') stack.push(id)
    else {
      const end = structure.ends.get(id)
      if (end) stack.push(end.from, end.to)
    }
  }
  // Each entity and, transitively, what contains it.
  while (stack.length) {
    const id = stack.pop()!
    if (found.has(id)) continue
    add(id)
    for (const {parent, relationship} of structure.parents.get(id) ?? []) {
      add(relationship)
      stack.push(parent)
    }
  }
  return added
}

/** A row's structural context in one revision, as item IDs, without the row's own. */
export function structuralContext(structure: Structure, row: ScopeRow, side: Side): Set<string> {
  const found = new Set<string>()
  traverse(structure, row, side, found)
  for (const id of row[side]) found.delete(id)
  return found
}
