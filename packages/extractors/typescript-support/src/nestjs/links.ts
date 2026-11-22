import {declaredDependencies, lookup} from './metadata.js'
import type {Dependency, Graph, NestModule, Registration, Wrapper} from './model.js'

export interface Link {
  from: Registration
  to: Registration
  dependency: Dependency | undefined
  confidence: 'authoritative' | 'derived'
  alias: boolean
}

export interface Registrations {
  byWrapper: Map<Wrapper, Registration>
  byId: Map<string, Registration>
}

/** Every provider and controller of every module, by its wrapper and by the wrapper's id. */
export function registrationsOf(
  modules: NestModule[],
  moduleKeys: Map<NestModule, string>,
  tokenId: (token: unknown) => string,
  coreProviders: Set<unknown>,
  applicationModule: (module: NestModule) => boolean,
): Registrations {
  const byWrapper = new Map<Wrapper, Registration>()
  const byId = new Map<string, Registration>()
  for (const module of modules) {
    const moduleKey = moduleKeys.get(module)!
    const entries: [Wrapper, Registration['role']][] = [
      ...[...module.providers.values()].map(wrapper => [wrapper, 'provider'] as [Wrapper, Registration['role']]),
      ...[...module.controllers.values()].map(wrapper => [wrapper, 'controller'] as [Wrapper, Registration['role']]),
    ]
    for (const [wrapper, role] of entries) {
      const core = wrapper.token === module.metatype || coreProviders.has(wrapper.token)
      const service = `service:${moduleKey}:${tokenId(wrapper.token)}`
      const registration: Registration = {
        module,
        moduleKey,
        wrapper,
        role,
        service,
        registration: `${service}:registration`,
        application: applicationModule(module) && !core,
      }
      byWrapper.set(wrapper, registration)
      byId.set(wrapper.id, registration)
    }
  }
  return {byWrapper, byId}
}

/** The injections the serialized graph records, then those it left out, by Nest's own lookup. */
export function linksOf(graph: Graph, registrations: Registrations): Link[] {
  const links: Link[] = []
  const covered = new Set<string>()
  for (const edge of Object.values(graph.edges ?? {})) {
    if (
      edge.metadata.type !== 'class-to-class' ||
      (edge.metadata.injectionType !== 'constructor' && edge.metadata.injectionType !== 'property')
    ) {
      continue
    }
    const from = registrations.byId.get(edge.source),
      to = registrations.byId.get(edge.target)
    if (!from || !to) continue
    const keyOrIndex = edge.metadata.keyOrIndex
    if (typeof keyOrIndex === 'symbol') continue
    const dependency = declaredDependencies(from.wrapper).find(
      item => item.keyOrIndex === keyOrIndex && (edge.metadata.injectionType === 'property') === (item.injection === 'property'),
    )
    covered.add(`${from.wrapper.id}:${edge.metadata.injectionType === 'property' ? 'property' : 'parameter'}:${String(keyOrIndex)}`)
    links.push({from, to, dependency, confidence: 'authoritative', alias: from.wrapper.isAlias === true})
  }
  // Preview leaves some injections unrecorded (property injection into a request-scoped
  // tree); those follow Nest's own module-scoped lookup of the declared token.
  for (const from of registrations.byWrapper.values()) {
    for (const dependency of declaredDependencies(from.wrapper)) {
      const key = `${from.wrapper.id}:${dependency.injection === 'property' ? 'property' : 'parameter'}:${String(dependency.keyOrIndex)}`
      if (covered.has(key)) continue
      const found = lookup(from.module, dependency.token)
      const to = found ? registrations.byWrapper.get(found[1]) : undefined
      if (!to) continue
      covered.add(key)
      links.push({from, to, dependency, confidence: 'derived', alias: from.wrapper.isAlias === true})
    }
  }
  return links
}
