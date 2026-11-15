import type {Relationship} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {compareIds} from '@githubnext/projections-renderer-kit'
import type {DependencyGraph} from './graph.js'
import type {Paths} from './model.js'

/**
 * The edges drawn between shown rows: every one, or with `primary` paths each package's primary path and every edge
 * added or removed. Also each shown row's neighbours, every edge included, and the dependents whose edges aren't drawn.
 */
export function shownEdges({edges, endpoints, roots, rootSet}: DependencyGraph, visible: ReadonlySet<string>, paths: Paths) {
  const between = (row: EntityChange<Relationship>) => endpoints(row).every(({from, to}) => visible.has(from) && visible.has(to))
  const neighbors = new Map<string, {dependents: string[]; dependencies: string[]}>(
    [...visible].map(id => [id, {dependents: [], dependencies: []}]),
  )
  for (const row of edges.filter(between))
    for (const {from, to} of endpoints(row)) {
      const source = neighbors.get(from)!,
        target = neighbors.get(to)!
      if (!source.dependencies.includes(to)) source.dependencies.push(to)
      if (!target.dependents.includes(from)) target.dependents.push(from)
    }
  for (const entry of neighbors.values()) {
    entry.dependents.sort(compareIds)
    entry.dependencies.sort(compareIds)
  }
  // Primary paths: breadth-first from the roots over shown packages, in ID order, so each package keeps the edge from
  // the package that first pulls it in. Packages no root reaches keep every edge.
  const primary = new Map<string, string>()
  if (paths === 'primary') {
    const reached = new Set(roots.filter(id => visible.has(id)))
    for (let queue = [...reached], index = 0; index < queue.length; index += 1) {
      const id = queue[index]!
      for (const child of neighbors.get(id)?.dependencies ?? [])
        if (!reached.has(child) && !rootSet.has(child)) {
          reached.add(child)
          primary.set(child, id)
          queue.push(child)
        }
    }
  }
  const onPath = (row: EntityChange<Relationship>) =>
    paths === 'all' ||
    row.status === 'added' ||
    row.status === 'removed' ||
    endpoints(row).some(({from, to}) => !primary.has(to) || primary.get(to) === from)
  const shown = edges.filter(row => between(row) && onPath(row))
  // The dependents whose edges aren't drawn.
  const drawn = new Map<string, Set<string>>()
  for (const row of shown) for (const {from, to} of endpoints(row)) drawn.set(to, (drawn.get(to) ?? new Set()).add(from))
  const otherDependents = new Map<string, string[]>()
  for (const id of primary.keys()) {
    const others = neighbors.get(id)!.dependents.filter(from => !drawn.get(id)?.has(from))
    if (others.length) otherDependents.set(id, others)
  }
  return {shown, neighbors, otherDependents}
}
