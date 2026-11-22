import type {ChangeStatus, DependencyInjectionExtraction, Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {compareIds, type ComparisonModel, type ScheduledStep} from '@githubnext/projections-renderer-kit'
import {layoutDiModel, type DiPosition} from './layout.js'
import {buildDiModel, type DiLink, type DiModel, type DiUnit} from './model.js'

/** What a unit shows of its own parts. The note is left out: it can depend on which other cards a revision has. */
function signature(unit: DiUnit): string {
  return [
    unit.contract ?? '',
    unit.implementation,
    unit.lifetime,
    unit.scope ?? '',
    unit.declaredLifetime ?? '',
    unit.aliasOf ?? '',
    unit.key ?? '',
    unit.registrations,
  ].join('|')
}

export type Window = Pick<ScheduledStep, 'time' | 'radius'>

/** One drawn link of both revisions: one per relationship row and side, so a link is never matched by its endpoints. */
interface UnionLink {
  key: string
  link: DiLink
  side: 'before' | 'after' | 'both'
}

/**
 * Both revisions in one composition, keyed by the comparison's presented
 * rows: every unit and link either revision shows, laid out once so nothing
 * overlaps or moves, and each unit's status. The transition and diff mode
 * both draw from it.
 */
export interface DiUnion {
  before: Map<string, DiUnit>
  after: Map<string, DiUnit>
  ids: string[]
  positions: Map<string, DiPosition>
  statuses: Map<string, {status: ChangeStatus; renamed: boolean}>
  links: UnionLink[]
  relationshipStatus: Map<string, ChangeStatus>
  entityRows: Map<string, EntityChange<Entity>>
}

/** Both revisions' units and links, laid out once for cards `height` tall. */
export function diUnion(model: ComparisonModel<DependencyInjectionExtraction>, height?: number): DiUnion {
  const entityRows = new Map(model.entities.map(row => [row.id, row]))
  const relationshipRow = {before: new Map<string, string>(), after: new Map<string, string>()}
  for (const row of model.relationships) {
    if (row.before) relationshipRow.before.set(row.before.id, row.id)
    if (row.after) relationshipRow.after.set(row.after.id, row.id)
  }
  const relationshipStatus = new Map(
    model.relationships.map(row => [row.id, row.status === 'modified' ? ('modified' as const) : ('unchanged' as const)]),
  )
  const canonical = (side: 'before' | 'after', composed: DiModel): DiModel => {
    const entity = (id: string) => model.entityRow[side].get(id) ?? id
    const optional = (id: string | undefined) => (id === undefined ? undefined : entity(id))
    return {
      units: composed.units.map(unit => ({
        ...unit,
        id: entity(unit.id),
        serviceId: optional(unit.serviceId),
        registrationId: optional(unit.registrationId),
        implementationId: optional(unit.implementationId),
        parts: unit.parts.map(entity),
      })),
      links: composed.links.map(link => ({
        ...link,
        from: entity(link.from),
        to: entity(link.to),
        id: relationshipRow[side].get(link.id) ?? link.id,
      })),
    }
  }
  const beforeModel = canonical('before', buildDiModel(model.before))
  const afterModel = canonical('after', buildDiModel(model.after))
  const beforeUnits = new Map(beforeModel.units.map(unit => [unit.id, unit]))
  const afterUnits = new Map(afterModel.units.map(unit => [unit.id, unit]))
  const ids = [...new Set([...beforeUnits.keys(), ...afterUnits.keys()])].sort(compareIds)
  const positions = layoutDiModel(
    {
      units: ids.map(id => (afterUnits.get(id) ?? beforeUnits.get(id))!),
      links: [...beforeModel.links, ...afterModel.links],
    },
    height,
  )

  function unitStatus(id: string, a: DiUnit | undefined, b: DiUnit | undefined): {status: ChangeStatus; renamed: boolean} {
    if (!a) return {status: 'added', renamed: false}
    if (!b) return {status: 'removed', renamed: false}
    const parts = [...new Set([id, ...a.parts, ...b.parts])].map(part => entityRows.get(part)).filter(row => row !== undefined)
    const changed = parts.some(row => row.status !== 'unchanged')
    const renamed = parts.some(row => row.renamed === true)
    return {status: changed || signature(a) !== signature(b) ? 'modified' : 'unchanged', renamed}
  }
  const statuses = new Map(ids.map(id => [id, unitStatus(id, beforeUnits.get(id), afterUnits.get(id))]))

  // Duplicates a revision draws over each other (two folded implementations injecting the same
  // parameter) show once, as the row that sorts first.
  const visual = (link: DiLink) =>
    `${link.from}→${link.to}:${link.parameter ?? ''}:${link.alias ? 'alias' : link.resolution ? 'runtime' : 'constructor'}`
  const sideLinks = (links: DiLink[]) => {
    const kept = new Map<string, DiLink>()
    for (const link of [...links].sort((a, b) => compareIds(a.id, b.id))) if (!kept.has(visual(link))) kept.set(visual(link), link)
    return new Map([...kept.values()].map(link => [link.id, link]))
  }
  const beforeLinks = sideLinks(beforeModel.links),
    afterLinks = sideLinks(afterModel.links)
  const links = [...new Set([...beforeLinks.keys(), ...afterLinks.keys()])].sort(compareIds).flatMap((row): UnionLink[] => {
    const a = beforeLinks.get(row),
      b = afterLinks.get(row)
    if (a && a.from === b?.from && a.to === b.to) return [{key: row, link: b, side: 'both'}]
    return [
      ...(a ? [{key: b ? `${row}:before` : row, link: a, side: 'before'} satisfies UnionLink] : []),
      ...(b ? [{key: a ? `${row}:after` : row, link: b, side: 'after'} satisfies UnionLink] : []),
    ]
  })
  return {before: beforeUnits, after: afterUnits, ids, positions, statuses, links, relationshipStatus, entityRows}
}
