import type {DiLink, DiUnit, Lifetime} from './model.js'

export const lifetimeNames: Record<Lifetime, string> = {
  singleton: 'Singleton',
  scoped: 'Scoped',
  transient: 'Transient',
  unknown: 'Unregistered',
}

/** The lifetime as a human label (`Singleton`), or the container's own scope name exactly as the data has it (`request`). */
export function lifetimeLabel(unit: DiUnit): string {
  return unit.scope ?? lifetimeNames[unit.lifetime]
}

/** What a diff card says changed about a unit present in both revisions, each named after the data it comes from. */
export type DiFacet = 'service' | 'implementation' | 'lifetime' | 'registrations'

/** Each facet's noun, singular and plural: the entity kinds and `data` fields it is drawn from. */
export const facetNouns: Record<DiFacet, [string, string]> = {
  service: ['service type', 'service types'],
  implementation: ['implementation', 'implementations'],
  lifetime: ['lifetime', 'lifetimes'],
  registrations: ['registration count', 'registration counts'],
}

export interface DiFacetChange {
  facet: DiFacet
  before: string
  after: string
  /** Whether the values are code identifiers (type names), drawn in the monospace font. */
  identifier: boolean
}

/** What differs between two versions of a unit, as the card shows it. */
export function unitFacets(before: DiUnit, after: DiUnit): DiFacetChange[] {
  const facets: DiFacetChange[] = []
  const compare = (facet: DiFacet, a: string | undefined, b: string | undefined, identifier: boolean) => {
    if (a !== undefined && b !== undefined && a !== b) facets.push({facet, before: a, after: b, identifier})
  }
  compare('service', before.contract, after.contract, true)
  compare('implementation', before.implementation, after.implementation, true)
  compare('lifetime', lifetimeLabel(before), lifetimeLabel(after), false)
  compare('registrations', String(before.registrations), String(after.registrations), false)
  return facets
}

/** The kind of link, as the legend and summary name it. */
export type DiLinkKind = 'dependency' | 'runtime resolution' | 'alias'
export const linkKind = (link: Pick<DiLink, 'alias' | 'resolution'>): DiLinkKind =>
  link.alias ? 'alias' : link.resolution ? 'runtime resolution' : 'dependency'
