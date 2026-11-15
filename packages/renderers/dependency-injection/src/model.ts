import {isKind} from '@githubnext/projections-schemas'
import type {DependencyInjectionExtraction, Entity} from '@githubnext/projections-schemas'
import {compareIds} from '@githubnext/projections-renderer-kit'

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

function shortName(value: string): string {
  const withoutGenerics = value.replace(/`\d+$/, '')
  return withoutGenerics.split('.').at(-1) ?? withoutGenerics
}

function lifetimeOf(value: unknown): Lifetime {
  const text = String(value ?? '').toLowerCase()
  return text === 'singleton' || text === 'scoped' || text === 'transient' ? text : 'unknown'
}

function typeOf(entity: Entity | undefined): string | undefined {
  const type = entity?.data?.type
  return typeof type === 'string' ? type : entity?.label
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

/** The container's own scope name, when it is more specific than the lifetime it maps to. */
function scopeOf(value: unknown, lifetime: Lifetime): string | undefined {
  const scope = text(value)
  const name = scope?.toLowerCase()
  return scope && name !== lifetime && name !== 'default' ? scope : undefined
}

/** The name a container derives from a type by default (`OrdersService` → `ordersService`). */
const conventionalName = (type: string | undefined): string | undefined => (type ? type.charAt(0).toLowerCase() + type.slice(1) : undefined)

/**
 * Composition is derived from endpoint kinds rather than relationship kinds so
 * an extractor that labels its relationships differently still resolves.
 * IDs are the extraction's own entity and relationship IDs.
 */
export function buildDiModel(state: Pick<DependencyInjectionExtraction, 'entities' | 'relationships'>): DiModel {
  const nodes = new Map(state.entities.map(node => [node.id, node]))
  const registrations = new Map<string, string[]>()
  const implementations = new Map<string, string>()
  const aliases = new Map<string, {id: string; to: string}>()
  const dependencies: DiLink[] = []
  for (const edge of state.relationships) {
    const from = nodes.get(edge.from)
    const to = nodes.get(edge.to)
    if (!from || !to) continue
    if (from.kind === 'service' && to.kind === 'registration') {
      registrations.set(from.id, [...(registrations.get(from.id) ?? []), to.id])
    } else if (from.kind === 'registration' && to.kind === 'implementation') {
      implementations.set(from.id, to.id)
    } else if (from.kind === 'registration' && to.kind === 'service') {
      aliases.set(from.id, {id: edge.id, to: to.id})
    } else if (from.kind === 'implementation' && to.kind === 'service') {
      dependencies.push({
        id: edge.id,
        from: from.id,
        to: to.id,
        parameter: typeof edge.data?.parameter === 'string' ? edge.data.parameter : undefined,
        collection: edge.data?.collection === true,
        optional: edge.data?.optional === true,
        resolution: edge.kind === 'resolves',
        alias: false,
      })
    }
  }

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
    if (alias)
      dependencies.push({id: alias.id, from: service.id, to: alias.to, collection: false, optional: false, resolution: false, alias: true})
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

  // Two cards that would read the same are told apart by their container names.
  const lookalikes = new Map<string, DiUnit[]>()
  for (const unit of units) {
    const look = `${unit.contract ?? ''}|${unit.implementation}`
    lookalikes.set(look, [...(lookalikes.get(look) ?? []), unit])
  }
  for (const group of lookalikes.values()) {
    if (group.length < 2) continue
    for (const unit of group) {
      const name = text(nodes.get(unit.serviceId ?? '')?.data?.name)
      if (name) unit.note = name
    }
  }

  const ids = new Set(units.map(unit => unit.id))
  const seen = new Set<string>()
  const links: DiLink[] = []
  for (const dependency of dependencies) {
    const from = dependency.alias ? dependency.from : unitOfImplementation.get(dependency.from)
    const to = ids.has(dependency.to) ? dependency.to : undefined
    if (!from || !to || from === to || !ids.has(from) || seen.has(dependency.id)) continue
    seen.add(dependency.id)
    links.push({...dependency, from, to})
  }
  units.sort((a, b) => compareIds(a.id, b.id))
  links.sort((a, b) => compareIds(a.id, b.id))
  return {units, links}
}

/** Rows a unit presents, for search and selection. */
export function unitParts(unit: DiUnit): string[] {
  return [unit.serviceId, unit.registrationId, unit.implementationId].filter((part): part is string => !!part)
}
