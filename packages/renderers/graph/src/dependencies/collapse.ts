import type {Entity, Relationship} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {compareIds, isChanged} from '@githubnext/projections-renderer-kit'
import type {DependencyGraph} from './graph.js'
import {transitiveEdgePrefix, transitivePrefix} from './kinds.js'
import type {Expansion} from './model.js'

/**
 * Which rows show, and which hidden rows each shown one owns: every root and direct dependency, every changed row and
 * the endpoints of every changed edge with the path that pulls each in, plus the children of expanded rows. Each
 * hidden row belongs to the first shown row that pulls it in, nearest the roots first.
 */
export function collapse(graph: DependencyGraph, expansion: Expansion) {
  const {rows, ids, edges, endpoints, children, roots, direct, depth, parent} = graph
  // Rows no root reaches have nothing to collapse into, so they stay visible.
  const base = new Set<string>(expansion === 'all' ? ids : [...roots, ...direct, ...ids.filter(id => !depth.has(id))])
  const anchors = new Set(ids.filter(id => isChanged(rows.get(id)!)))
  for (const row of edges) if (isChanged(row)) for (const {from, to} of endpoints(row)) anchors.add(from).add(to)
  for (const anchor of [...anchors].sort(compareIds))
    for (let id: string | undefined = anchor; id !== undefined && !base.has(id); id = parent.get(id)) base.add(id)
  // An expanded package shows its children; an expanded child that shows, in turn, shows its own.
  const reveal = (open: ReadonlySet<string>) => {
    const shown = new Set(base)
    const order = [...open].sort(compareIds)
    for (let grew = true; grew;) {
      grew = false
      for (const id of order)
        if (shown.has(id))
          for (const child of children(id))
            if (!shown.has(child)) {
              shown.add(child)
              grew = true
            }
    }
    return shown
  }
  // Each hidden package belongs to the first shown package that pulls it in, nearest the roots first.
  const ownership = (shown: ReadonlySet<string>) => {
    const owner = new Map<string, string>()
    const queue = [...shown].sort((a, b) => (depth.get(a) ?? Infinity) - (depth.get(b) ?? Infinity) || compareIds(a, b))
    for (let index = 0; index < queue.length; index += 1) {
      const id = queue[index]!
      const by = shown.has(id) ? id : owner.get(id)!
      for (const child of children(id))
        if (!shown.has(child) && !owner.has(child)) {
          owner.set(child, by)
          queue.push(child)
        }
    }
    return owner
  }
  const membersBy = (owner: ReadonlyMap<string, string>) => {
    const owned = new Map<string, string[]>()
    for (const [id, by] of owner) owned.set(by, [...(owned.get(by) ?? []), id])
    return owned
  }
  const visible = expansion === 'all' ? base : reveal(expansion)
  const owner = ownership(visible)
  const owned = membersBy(owner)
  // An expanded package that shows keeps a card where its summary was, to collapse it again: it counts what its
  // summary would, so the same card opens and closes the same packages.
  const opened = new Map<string, string[]>()
  if (expansion !== 'all')
    for (const by of [...expansion].sort(compareIds)) {
      if (!visible.has(by) || owned.has(by)) continue
      const rest = new Set(expansion)
      rest.delete(by)
      const members = membersBy(ownership(reveal(rest))).get(by)
      if (members?.length) opened.set(by, members)
    }
  return {visible, owner, owned, opened}
}

/** One summary card (and its edge from its owner) per shown row that owns hidden rows, or that was expanded. */
export function summaryCards(
  rows: ReadonlyMap<string, EntityChange<Entity>>,
  owned: ReadonlyMap<string, string[]>,
  opened: ReadonlyMap<string, string[]>,
) {
  const summaries: EntityChange<Entity>[] = []
  const summaryEdges: EntityChange<Relationship>[] = []
  const summaryOf = new Map<string, string>()
  for (const by of [...new Set([...owned.keys(), ...opened.keys()])].sort(compareIds)) {
    const open = opened.has(by)
    const members = (open ? opened : owned).get(by)!
    const ownerRow = rows.get(by)!
    const id = `${transitivePrefix}${by}`
    const entity = (side: 'before' | 'after'): Entity | undefined => {
      const count = members.filter(member => rows.get(member)![side]).length
      const packages = count === 1 ? 'package' : 'packages'
      return ownerRow[side] && count
        ? open
          ? {id, kind: 'transitive', label: `Collapse ${count} ${packages}`, data: {count, expanded: true}}
          : {id, kind: 'transitive', label: `${count} more ${packages}`, data: {count}}
        : undefined
    }
    const before = entity('before')
    const after = entity('after')
    if (!before && !after) continue
    const status = before && after ? 'unchanged' : after ? 'added' : 'removed'
    summaries.push({id, ...(before ? {before} : {}), ...(after ? {after} : {}), status, correspondence: 'exact'})
    const edgeId = `${transitiveEdgePrefix}${by}`
    const edge = (side: 'before' | 'after', present: Entity | undefined): Relationship | undefined =>
      present && {id: edgeId, kind: 'transitive', from: ownerRow[side]!.id, to: id}
    const edgeBefore = edge('before', before)
    const edgeAfter = edge('after', after)
    summaryEdges.push({
      id: edgeId,
      ...(edgeBefore ? {before: edgeBefore} : {}),
      ...(edgeAfter ? {after: edgeAfter} : {}),
      status,
      correspondence: 'exact',
    })
    summaryOf.set(by, id)
  }
  return {summaries, summaryEdges, summaryOf}
}
