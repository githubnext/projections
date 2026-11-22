import type {Relationship} from '@githubnext/projections-schemas'
import {compareIds, type ComparisonModel, type Stage, type StagedTimeline} from '@githubnext/projections-renderer-kit'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import type {Snapshot} from './pack/hierarchy.js'
import {pathOf} from './files.js'

const kindOf = (row: EntityChange<Relationship>) => (row.after ?? row.before)!.kind

/** Whether containment is declared with `contains` relationships; otherwise every relationship is a parent link (a weighted hierarchy). */
function containmentFilter(model: ComparisonModel): (relationship: Relationship) => boolean {
  const declared = model.relationships.some(row => kindOf(row) === 'contains')
  return relationship => !declared || relationship.kind === 'contains'
}

/** Every row of either revision, in its latest version, with its links: the union a diff packs. */
export function unionSnapshot(model: ComparisonModel, include?: ReadonlySet<string>): Snapshot {
  const rows = new Map(model.entities.map(row => [row.id, row]))
  const contains = containmentFilter(model)
  const active = new Set(model.entities.map(row => row.id).filter(id => !include || include.has(id)))
  const links: {from: string; to: string}[] = []
  for (const row of model.relationships) {
    const side = row.after ?? row.before!
    if (!contains(side)) continue
    const ends = row.after ? model.entityRow.after : model.entityRow.before
    const from = ends.get(side.from),
      to = ends.get(side.to)
    if (from && to && active.has(from) && active.has(to)) links.push({from, to})
  }
  return {active, links, entity: id => rows.get(id)!.after ?? rows.get(id)!.before!}
}

/** One revision alone: `after` or `before` rows and links. */
export function sideSnapshot(model: ComparisonModel, side: 'before' | 'after', include?: ReadonlySet<string>): Snapshot {
  const rows = new Map(model.entities.map(row => [row.id, row]))
  const contains = containmentFilter(model)
  const active = new Set(model.entities.filter(row => row[side] && (!include || include.has(row.id))).map(row => row.id))
  const links: {from: string; to: string}[] = []
  for (const row of model.relationships) {
    const relationship = row[side]
    if (!relationship || !contains(relationship)) continue
    const from = model.entityRow[side].get(relationship.from),
      to = model.entityRow[side].get(relationship.to)
    if (from && to && active.has(from) && active.has(to)) links.push({from, to})
  }
  return {active, links, entity: id => rows.get(id)![side]!}
}

export function stageSnapshot(model: ComparisonModel, timeline: StagedTimeline, stage: Stage): Snapshot {
  const rows = new Map(model.entities.map(row => [row.id, row]))
  const contains = containmentFilter(model)
  return {
    active: stage.active,
    entity: id => timeline.version(rows.get(id)!, stage),
    links: timeline
      .relationships(stage)
      .filter(link => contains(timeline.version(link.row, stage)))
      .map(({from, to}) => ({from, to})),
  }
}

/**
 * Each row's repository path: its `data.path`, or its labels joined from the
 * top of the union hierarchy (for weighted hierarchies without paths). The
 * root row of a single-rooted hierarchy has none.
 */
export function rowPaths(model: ComparisonModel): {paths: Map<string, string>; root?: string; tops: string[]} {
  const union = unionSnapshot(model)
  const parent = new Map<string, string>()
  for (const {from, to} of union.links.toSorted((a, b) => compareIds(a.to, b.to) || compareIds(a.from, b.from))) {
    if (from === to || parent.has(to)) continue
    let cursor: string | undefined = from
    while (cursor !== undefined && cursor !== to) cursor = parent.get(cursor)
    if (cursor !== to) parent.set(to, from)
  }
  const roots = [...union.active].filter(id => !parent.has(id)).toSorted(compareIds)
  const hasChildren = new Set(parent.values())
  const root = roots.length === 1 && hasChildren.has(roots[0]!) ? roots[0] : undefined
  const paths = new Map<string, string>()
  const resolve = (id: string): string => {
    const known = paths.get(id)
    if (known !== undefined) return known
    if (id === root) return ''
    const entity = union.entity(id)
    const declared = pathOf(entity)
    const above = parent.get(id)
    const path = declared ?? (above === undefined || above === root ? entity.label : `${resolve(above)}/${entity.label}`)
    paths.set(id, path)
    return path
  }
  for (const id of union.active) resolve(id)
  const tops = root ? [...union.active].filter(id => parent.get(id) === root) : roots
  return {paths, ...(root === undefined ? {} : {root}), tops: tops.filter(id => hasChildren.has(id)).toSorted(compareIds)}
}
