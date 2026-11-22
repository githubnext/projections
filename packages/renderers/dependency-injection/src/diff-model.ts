import type {ChangeStatus, DependencyInjectionExtraction, Entity} from '@githubnext/projections-schemas'
import {sentenceCase, type EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {compareIds, type ComparisonModel} from '@githubnext/projections-renderer-kit'
import {diCardText, diMetrics, type DiCardText} from './geometry.js'
import {facetNouns, lifetimeLabel, linkKind, unitFacets, type DiFacetChange, type DiLinkKind} from './facets.js'
import type {DiUnit} from './model.js'
import type {DiLinkFrame} from './transition.js'
import {diUnion} from './union.js'

/** `text` with its first letter capitalized, unless it starts with a name written in lowercase (see `sentenceCase`). */
export const capitalize = sentenceCase

/** A link a unit present in both revisions gained or lost, shown on its card. */
export interface DiDependencyChange {
  key: string
  /** Relationship row ID. */
  id: string
  change: 'added' | 'removed'
  kind: DiLinkKind
  /** The unit it points at, and that unit's shown name. */
  to: string
  name: string
}

export interface DiDiffUnit {
  id: string
  before?: DiUnit | undefined
  after?: DiUnit | undefined
  /** The version drawn: After when it exists, otherwise Before. */
  unit: DiUnit
  status: ChangeStatus
  renamed: boolean
  x: number
  /** The card's centre without its change lines: the top is `y - diMetrics.height / 2`, as in the transition. */
  y: number
  /** The card's full height: its body (taller when its text wraps), its change lines and its footer. */
  height: number
  facets: DiFacetChange[]
  dependencies: DiDependencyChange[]
  /** The card's text, whole: names, labels and change lines on as many lines as they need (see `diCardText`). */
  text: DiCardText
}

export interface DiDiff {
  units: DiDiffUnit[]
  links: DiLinkFrame[]
  runtimeResolution: boolean
  aliases: boolean
  /** The comparison's entity row with this ID, for a part's own change. */
  row(id: string): EntityChange<Entity> | undefined
}

/**
 * Diff mode: both revisions at once, in the transition's own composition
 * (the same union layout), every unit and link drawn once with its change.
 * A unit in both revisions lists what differs about it (`unitFacets`) and,
 * when it gained or lost links, which. Text is never cut short: long names
 * and values wrap (`diCardText`). Wrapped text and change lines make a card
 * taller, and each layer below moves down by its tallest card's extra height
 * so nothing overlaps. A rewired link is drawn twice: its old route removed, its new
 * one added.
 */
export function createDiDiff(model: ComparisonModel<DependencyInjectionExtraction>): DiDiff {
  const {before, after, ids, positions, statuses, links, relationshipStatus, entityRows} = diUnion(model)
  const shownName = (id: string) => {
    const unit = (after.get(id) ?? before.get(id))!
    return unit.contract ?? unit.implementation
  }
  const units = ids.map((id): Omit<DiDiffUnit, 'x' | 'y' | 'height'> & {height: number} => {
    const a = before.get(id),
      b = after.get(id)
    const {status, renamed} = statuses.get(id)!
    const facets = a && b ? unitFacets(a, b) : []
    const dependencies =
      a && b
        ? links
            .filter(item => item.side !== 'both' && item.link.from === id)
            .map((item): DiDependencyChange => ({
              key: item.key,
              id: item.link.id,
              change: item.side === 'before' ? 'removed' : 'added',
              kind: linkKind(item.link),
              to: item.link.to,
              name: shownName(item.link.to),
            }))
            .sort((x, y) =>
              x.change === y.change ? compareIds(x.name, y.name) || compareIds(x.key, y.key) : x.change === 'removed' ? -1 : 1,
            )
        : []
    const unit = (b ?? a)!
    const lifetimeFacet = facets.find(facet => facet.facet === 'lifetime')
    const implementationFacet = facets.find(facet => facet.facet === 'implementation')
    const text = diCardText({
      contract: unit.contract,
      implementation: unit.implementation,
      implementationBefore: implementationFacet?.before,
      lifetime: {before: lifetimeFacet?.before, after: lifetimeLabel(unit), code: !!unit.scope},
      note: unit.key
        ? {prefix: 'key ', text: unit.key, code: true}
        : unit.registrations > 1
          ? {text: `×${unit.registrations}`, code: false}
          : unit.note
            ? {text: unit.note, code: true}
            : undefined,
      // The lifetime and the implementation show their change in place; the other facets are listed under them.
      facets: facets
        .filter(facet => facet !== lifetimeFacet && facet !== implementationFacet)
        .map(facet => ({...facet, key: capitalize(facetNouns[facet.facet][0])})),
      dependencies,
    })
    return {id, before: a, after: b, unit, status, renamed, facets, dependencies, text, height: text.height}
  })
  // Each layer moves down by the extra height of the tallest card above it.
  const extra: number[] = []
  for (const unit of units) {
    const depth = positions.get(unit.id)!.depth
    extra[depth] = Math.max(extra[depth] ?? 0, unit.height - diMetrics.height)
  }
  const offsets: number[] = []
  for (let depth = 0, total = 0; depth < extra.length; depth++) {
    offsets[depth] = total
    total += extra[depth] ?? 0
  }
  const placed = units.map((unit): DiDiffUnit => {
    const position = positions.get(unit.id)!
    return {...unit, x: position.x, y: position.y + (offsets[position.depth] ?? 0)}
  })
  const byId = new Map(placed.map(unit => [unit.id, unit]))
  const frames = links.flatMap(({key, link, side}): DiLinkFrame[] => {
    const from = byId.get(link.from),
      to = byId.get(link.to)
    if (!from || !to) return []
    return [
      {
        id: link.id,
        key,
        fromId: link.from,
        toId: link.to,
        from: {x: from.x, y: from.y - diMetrics.height / 2 + from.height},
        to: {x: to.x, y: to.y - diMetrics.height / 2},
        status: side === 'both' ? (relationshipStatus.get(link.id) ?? 'unchanged') : side === 'before' ? 'removed' : 'added',
        opacity: 1,
        parameter: link.parameter,
        collection: link.collection,
        optional: link.optional,
        resolution: link.resolution,
        alias: link.alias,
      },
    ]
  })
  return {
    units: placed,
    links: frames,
    runtimeResolution: frames.some(link => link.resolution),
    aliases: frames.some(link => link.alias),
    row: id => entityRows.get(id),
  }
}
