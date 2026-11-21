import {isKind} from '@githubnext/projections-schemas'
import type {DependencyInjectionExtraction} from '@githubnext/projections-schemas'
import {compareIds} from '@githubnext/projections-renderer-kit'
import {
  conventionalName,
  distinguishLookalikes,
  indexComposition,
  lifetimeOf,
  resolveLinks,
  scopeOf,
  shortName,
  text,
  typeOf,
} from './composition.js'

export type Lifetime = 'singleton' | 'scoped' | 'transient' | 'unknown'

/**
 * One composed dependency-injection unit. A container registration is three
 * semantic entities — the requested contract, the registration that binds it,
 * and the implementation that satisfies it — but it is a single decision, so
 * presentation folds the triple into one inspectable unit.
 */
export interface DiUnit {
  id: string
  serviceId?: string | undefined
  registrationId?: string | undefined
  implementationId?: string | undefined
  contract?: string | undefined
  implementation: string
  lifetime: Lifetime
  /**
   * The container's own name for the lifetime when it says more than `lifetime`
   * (`prototype`, `request`, `session`), from the registration's `data.scope`.
   */
  scope?: string | undefined
  /** The lifetime the registration asked for, when the container changed it (a singleton that injects a scoped service). */
  declaredLifetime?: Lifetime | undefined
  /** The contract of the service an alias registration forwards to (`useExisting`). */
  aliasOf?: string | undefined
  key?: string | undefined
  /** The registration's container name or module, when it tells otherwise identical cards apart. */
  note?: string | undefined
  registrations: number
  /** Every entity the unit folds in: its service, each registration and each implementation. */
  parts: string[]
}

export interface DiLink {
  id: string
  from: string
  to: string
  parameter?: string | undefined
  collection: boolean
  optional: boolean
  resolution: boolean
  /** An alias registration forwarding to the service it names, not an injection. */
  alias: boolean
}

export interface DiModel {
  units: DiUnit[]
  links: DiLink[]
}

/**
 * Composition is derived from endpoint kinds rather than relationship kinds so
 * an extractor that labels its relationships differently still resolves.
 * IDs are the extraction's own entity and relationship IDs.
 */
export function buildDiModel(state: Pick<DependencyInjectionExtraction, 'entities' | 'relationships'>): DiModel {
  const {nodes, registrations, implementations, aliases, dependencies} = indexComposition(state)
  const units: DiUnit[] = []
  const unitOfImplementation = new Map<string, string>()
  const claimed = new Set<string>()
  // Registration IDs come from edges to `registration` entities, whose typed data the vocabulary guarantees.
  const registrationOf = (id: string | undefined) => {
    const node = nodes.get(id ?? '')
    return node && isKind(node, 'registration') ? node : undefined
  }
  for (const service of state.entities.filter(node => isKind(node, 'service'))) {
    const registrationIds = [...(registrations.get(service.id) ?? [])].sort((a, b) => {
      const left = registrationOf(a)?.data.ordinal ?? 0
      const right = registrationOf(b)?.data.ordinal ?? 0
      return left === right ? compareIds(a, b) : left - right
    })
    // The container resolves the last registration, so that one is the unit.
    const registration = registrationOf(registrationIds.at(-1))
    const implementationId = registration ? implementations.get(registration.id) : undefined
    const implementation = implementationId ? nodes.get(implementationId) : undefined
    const alias = registration ? aliases.get(registration.id) : undefined
    const aliasOf = alias ? shortName(typeOf(nodes.get(alias.to)) ?? alias.to) : undefined
    const implementationType = typeOf(implementation) ?? registration?.data.implementation
    const contractType = typeOf(service)
    const selfRegistered = !implementationType || implementationType === contractType
    const parts = [service.id]
    for (const id of registrationIds) {
      claimed.add(id)
      parts.push(id)
      // Earlier registrations stay enumerable; their implementations are part of this stacked unit.
      const earlier = implementations.get(id)
      if (earlier && !claimed.has(earlier)) {
        claimed.add(earlier)
        parts.push(earlier)
        unitOfImplementation.set(earlier, service.id)
      }
    }
    if (implementationId && !parts.includes(implementationId)) parts.push(implementationId)
    if (implementationId) {
      claimed.add(implementationId)
      unitOfImplementation.set(implementationId, service.id)
    }
    if (alias) {
      dependencies.push({id: alias.id, from: service.id, to: alias.to, collection: false, optional: false, resolution: false, alias: true})
    }
    const lifetime = lifetimeOf(registration?.data.lifetime)
    const declaredLifetime = registration?.data.declaredLifetime === undefined ? undefined : lifetimeOf(registration.data.declaredLifetime)
    const name = text(service.data.name)
    const shownContract = selfRegistered ? undefined : shortName(contractType ?? service.label ?? service.id)
    const shownImplementation = aliasOf ?? shortName(implementationType ?? contractType ?? service.label ?? service.id)
    units.push({
      id: service.id,
      serviceId: service.id,
      registrationId: registration?.id,
      implementationId,
      contract: aliasOf ? shortName(contractType ?? service.label ?? service.id) : shownContract,
      implementation: shownImplementation,
      lifetime,
      scope: scopeOf(registration?.data.scope, lifetime),
      declaredLifetime: declaredLifetime !== lifetime ? declaredLifetime : undefined,
      aliasOf,
      key: service.data.key !== 'unkeyed' ? service.data.key : undefined,
      // A container name (a Spring bean name) only when it is not the one derived from the type.
      note:
        name && ![conventionalName(shownImplementation), conventionalName(shownContract)].includes(name)
          ? name
          : (text(registration?.data.module) ?? text(service.data.module)),
      registrations: Math.max(1, registrationIds.length),
      parts,
    })
  }
  // Implementations no registration resolves are still real; never hide them.
  for (const node of state.entities) {
    if (node.kind !== 'implementation' || claimed.has(node.id)) continue
    unitOfImplementation.set(node.id, node.id)
    units.push({
      id: node.id,
      implementationId: node.id,
      implementation: shortName(typeOf(node) ?? node.id),
      lifetime: 'unknown',
      registrations: 0,
      parts: [node.id],
    })
  }

  distinguishLookalikes(units, nodes)
  const links = resolveLinks(dependencies, units, unitOfImplementation)
  units.sort((a, b) => compareIds(a.id, b.id))
  links.sort((a, b) => compareIds(a.id, b.id))
  return {units, links}
}

/** Rows a unit presents, for search and selection. */
export function unitParts(unit: DiUnit): string[] {
  return [unit.serviceId, unit.registrationId, unit.implementationId].filter((part): part is string => !!part)
}
