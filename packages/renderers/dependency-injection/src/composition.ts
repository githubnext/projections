// The parts of composing a dependency-injection model: the relationships indexed by what they join, the values a
// card states, and the cards and links finished once every unit is known.
import type {DependencyInjectionExtraction, Entity} from '@githubnext/projections-schemas'
import type {DiLink, DiUnit, Lifetime} from './model.js'
import {shortTypeName} from './type-name.js'

export const shortName = shortTypeName

export function lifetimeOf(value: unknown): Lifetime {
  const text = typeof value === 'string' ? value.toLowerCase() : ''
  return text === 'singleton' || text === 'scoped' || text === 'transient' ? text : 'unknown'
}

export function typeOf(entity: Entity | undefined): string | undefined {
  const type = entity?.data?.type
  return typeof type === 'string' ? type : entity?.label
}

export const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)

/** The container's own scope name, when it is more specific than the lifetime it maps to. */
export function scopeOf(value: unknown, lifetime: Lifetime): string | undefined {
  const scope = text(value)
  const name = scope?.toLowerCase()
  return scope && name !== lifetime && name !== 'default' ? scope : undefined
}

/** The name a container derives from a type by default (`OrdersService` → `ordersService`). */
export const conventionalName = (type: string | undefined): string | undefined =>
  type ? type.charAt(0).toLowerCase() + type.slice(1) : undefined

/**
 * The extraction's relationships by the kinds of entity they join: each service's registrations, each registration's
 * implementation or the service it forwards to, and each implementation's dependencies.
 */
export function indexComposition(state: Pick<DependencyInjectionExtraction, 'entities' | 'relationships'>) {
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

  return {nodes, registrations, implementations, aliases, dependencies}
}

/** Two cards that would read the same are told apart by their container names. */
export function distinguishLookalikes(units: readonly DiUnit[], nodes: ReadonlyMap<string, Entity>): void {
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
}

/** Each dependency as a link between the units that hold its ends, once, and never from a unit to itself. */
export function resolveLinks(
  dependencies: readonly DiLink[],
  units: readonly DiUnit[],
  unitOfImplementation: ReadonlyMap<string, string>,
): DiLink[] {
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
  return links
}
