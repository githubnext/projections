import type {DependencyInjectionExtraction} from '@githubnext/projections-schemas'
import {compareIds} from '@githubnext/projections-renderer-kit'
import type {ComparisonModel, IconName, SummaryFactItem} from '@githubnext/projections-renderer-kit'
import {facetNouns, unitFacets} from './facets.js'
import type {DiFacet} from './facets.js'
import type {DiUnit} from './model.js'
import {diUnion} from './union.js'

const pluralOf = (noun: string) =>
  /[^aeiou]y$/.test(noun) ? `${noun.slice(0, -1)}ies` : /(s|x|z|ch|sh)$/.test(noun) ? `${noun}es` : `${noun}s`

/** A unit's kind, in the extraction's own words: a `service`, or an `implementation` no registration resolves. */
export const unitKind = (unit: DiUnit): string => (unit.serviceId ? 'service' : 'implementation')

/**
 * The summary bar's composition facts, what the kind counts can't say: units in both revisions whose service type,
 * implementation, lifetime or registration count changed (`1 lifetime changed`), then units renamed, by kind, each
 * filtering to the entities its units fold in. Units and links added and removed are the bar's kind counts.
 */
export function diFacts(model: ComparisonModel<DependencyInjectionExtraction>): SummaryFactItem[] {
  if (model.mode !== 'comparison') return []
  const {before, after, ids, statuses} = diUnion(model)
  const both = ids.flatMap(id => {
    const a = before.get(id),
      b = after.get(id)
    return a && b
      ? [{unit: b, facets: unitFacets(a, b), renamed: statuses.get(id)!.renamed, parts: [...new Set([...a.parts, ...b.parts])]}]
      : []
  })
  const facts: SummaryFactItem[] = []
  const fact = (id: string, units: typeof both, noun: readonly [string, string], icon: IconName) => {
    if (units.length)
      facts.push({
        type: 'fact',
        id,
        icon,
        count: units.length,
        noun: {singular: noun[0], plural: noun[1]},
        ids: [...new Set(units.flatMap(unit => unit.parts))],
      })
  }
  for (const facet of Object.keys(facetNouns) as DiFacet[]) {
    const [singular, plural] = facetNouns[facet]
    fact(
      `${facet}-changed`,
      both.filter(unit => unit.facets.some(item => item.facet === facet)),
      [`${singular} changed`, `${plural} changed`],
      'changed',
    )
  }
  const kinds = [...new Set(both.map(unit => unitKind(unit.unit)))].sort((a, b) =>
    a === 'service' ? -1 : b === 'service' ? 1 : compareIds(a, b),
  )
  for (const kind of kinds)
    fact(
      `${kind}-renamed`,
      both.filter(unit => unit.renamed && unitKind(unit.unit) === kind),
      [`${kind} renamed`, `${pluralOf(kind)} renamed`],
      'renamed',
    )
  return facts
}
