// Context a renderer adds to the Changes scope to place its changes (`MountOptions.scope` `context`), by following the
// relationships its domain draws them along.
import type {ComparisonModel} from './model.js'
import {sides} from './scope-parts.js'

/** Which relationships `followContext` follows, by kind: to an item's sources (`incoming`), or its targets (`outgoing`). */
export interface ContextPaths {
  /** Follow a relationship of this kind from its target back to its source (a dependency to the package that needs it). */
  incoming?: (kind: string) => boolean
  /** Follow a relationship of this kind from its source to its target (a probe to the hook it attaches to). */
  outgoing?: (kind: string) => boolean
}

/**
 * The rows that place a comparison's changes along the relationships `paths` names, transitively: from each changed
 * entity and each end of a changed relationship, in whichever revision has them, every entity reached and the
 * relationships followed to it. For example a changed package's dependents up to the workspace, or a changed selector's
 * probe, the probe's policy and the hook it attaches to.
 */
export function followContext(model: ComparisonModel, changes: ReadonlySet<string>, paths: ContextPaths): Set<string> {
  type Step = {relationship: string; entity: string}
  const next = new Map<string, Step[]>()
  const link = (from: string | undefined, step: Step) => {
    if (from === undefined) return
    const list = next.get(from) ?? []
    list.push(step)
    next.set(from, list)
  }
  const ends = new Map<string, string[]>()
  for (const row of model.relationships)
    for (const side of sides) {
      const item = row[side]
      if (!item) continue
      const from = model.entityRow[side].get(item.from),
        to = model.entityRow[side].get(item.to)
      ends.set(row.id, [...(ends.get(row.id) ?? []), ...[from, to].filter((id): id is string => id !== undefined)])
      if (from === undefined || to === undefined) continue
      if (paths.incoming?.(item.kind)) link(to, {relationship: row.id, entity: from})
      if (paths.outgoing?.(item.kind)) link(from, {relationship: row.id, entity: to})
    }
  const start = [
    ...model.entities.filter(row => changes.has(row.id)).map(row => row.id),
    ...model.relationships.filter(row => changes.has(row.id)).flatMap(row => ends.get(row.id) ?? []),
  ]
  const found = new Set<string>()
  const visited = new Set<string>()
  for (let stack = [...start], id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (visited.has(id)) continue
    visited.add(id)
    for (const step of next.get(id) ?? []) {
      found.add(step.relationship)
      found.add(step.entity)
      stack.push(step.entity)
    }
  }
  return found
}
