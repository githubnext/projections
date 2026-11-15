// Compound boundaries: which entities group others.
import {compareIds} from './model.js'
import type {LayoutEdge, LayoutNode} from './model.js'

/** The entity kinds a `compound` option lets become boundaries. */
export function boundaryKinds(compound: boolean | readonly string[] | undefined): readonly string[] {
  return compound === true ? ['module'] : compound || []
}

/**
 * Only unambiguous containment-only entities of the boundary kinds (default `module`) become compound nodes. `keep`
 * names boundaries that stay boundaries with nothing left in them (a transition keeps its union's, so a module
 * emptied by removals stays a boundary rather than turning into a card).
 */
export function moduleGroups(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  kinds: readonly string[] = ['module'],
  keep: ReadonlySet<string> = new Set(),
): Map<string, string[]> {
  const candidates = new Set(
    nodes
      .filter(
        node =>
          kinds.includes(node.kind) &&
          (keep.has(node.id) || edges.some(edge => edge.from === node.id && edge.kind === 'contains')) &&
          !edges.some(edge => edge.kind !== 'contains' && (edge.from === node.id || edge.to === node.id)),
      )
      .map(node => node.id),
  )
  const parents = new Map<string, Set<string>>()
  for (const edge of edges.filter(edge => edge.kind === 'contains')) {
    const incoming = parents.get(edge.to) ?? new Set<string>()
    incoming.add(edge.from)
    parents.set(edge.to, incoming)
  }
  for (const [child, incoming] of parents) {
    if (incoming.size > 1) {
      for (const parent of incoming) candidates.delete(parent)
    }
    const visited = new Set([child])
    let next = [...incoming][0]
    while (next) {
      if (visited.has(next)) {
        for (const id of visited) candidates.delete(id)
        break
      }
      visited.add(next)
      next = [...(parents.get(next) ?? [])][0]
    }
  }
  let changed: boolean
  do {
    changed = false
    for (const id of candidates) {
      if ([...(parents.get(id) ?? [])].some(parent => !candidates.has(parent))) {
        candidates.delete(id)
        changed = true
      }
    }
  } while (changed)
  const groups = new Map(
    [...candidates]
      .sort(compareIds)
      .map(id => [
        id,
        [...new Set(edges.filter(edge => edge.from === id && edge.kind === 'contains').map(edge => edge.to))].sort(compareIds),
      ]),
  )
  // A card contained by a card (a VM's extension) sits in the nearest boundary that contains them.
  const present = new Set(nodes.map(node => node.id))
  for (const [child, incoming] of parents) {
    if (incoming.size !== 1 || !present.has(child) || [...groups.values()].some(children => children.includes(child))) continue
    const visited = new Set([child])
    for (let parent = [...incoming][0]; parent && !visited.has(parent); parent = [...(parents.get(parent) ?? [])][0]) {
      visited.add(parent)
      if ((parents.get(parent)?.size ?? 0) > 1) break
      const children = groups.get(parent)
      if (children) {
        if (parent !== [...incoming][0]) children.push(child)
        break
      }
    }
  }
  for (const children of groups.values()) children.sort(compareIds)
  return groups
}
