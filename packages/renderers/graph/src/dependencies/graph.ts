import type {Relationship} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {compareIds} from '@githubnext/projections-renderer-kit'
import type {ComparisonModel} from '@githubnext/projections-renderer-kit'
import {isRootEntity, membershipKinds, sideOf} from './kinds.js'

/**
 * The dependency graph of both revisions at once, by row: its dependency edges, roots and direct dependencies, and
 * each row's breadth-first depth from the roots and the row that first pulls it in.
 */
export function dependencyGraph(model: ComparisonModel) {
  const rows = new Map(model.entities.map(row => [row.id, row]))
  const ids = [...rows.keys()].sort(compareIds)
  const edges = model.relationships.filter(row => !membershipKinds.has(sideOf(row).kind))
  const endpoints = (row: EntityChange<Relationship>) => {
    const pairs: {from: string | undefined; to: string | undefined}[] = []
    if (row.before) pairs.push({from: model.entityRow.before.get(row.before.from), to: model.entityRow.before.get(row.before.to)})
    if (row.after) pairs.push({from: model.entityRow.after.get(row.after.from), to: model.entityRow.after.get(row.after.to)})
    return pairs.filter((pair): pair is {from: string; to: string} => pair.from !== undefined && pair.to !== undefined)
  }
  const out = new Map<string, Set<string>>(ids.map(id => [id, new Set()]))
  const incoming = new Set<string>()
  for (const row of edges) {
    for (const {from, to} of endpoints(row)) {
      out.get(from)?.add(to)
      incoming.add(to)
    }
  }
  const children = (id: string) => [...(out.get(id) ?? [])].sort(compareIds)

  let roots = ids.filter(id => {
    const row = rows.get(id)!
    return [row.before, row.after].some(entity => entity && isRootEntity(entity))
  })
  // A graph without declared roots starts from what nothing depends on.
  if (!roots.length) roots = ids.filter(id => !incoming.has(id))
  const rootSet = new Set(roots)
  const direct = new Set(roots.flatMap(children).filter(id => !rootSet.has(id)))

  // Breadth-first from the roots, in ID order: each row's depth and the row that first pulls it in.
  const depth = new Map<string, number>(roots.map(id => [id, 0]))
  const parent = new Map<string, string>()
  for (let queue = [...roots], index = 0; index < queue.length; index += 1) {
    const id = queue[index]!
    for (const child of children(id)) {
      if (!depth.has(child)) {
        depth.set(child, depth.get(id)! + 1)
        parent.set(child, id)
        queue.push(child)
      }
    }
  }
  return {rows, ids, edges, endpoints, children, roots, rootSet, direct, depth, parent}
}

export type DependencyGraph = ReturnType<typeof dependencyGraph>
