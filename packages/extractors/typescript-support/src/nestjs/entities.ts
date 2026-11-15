import type {Entity, Evidence, Json, Relationship} from '../types.js'
import type {TokenIdentities} from './identity.js'
import type {Link} from './links.js'
import {declaredImportsOf} from './metadata.js'
import {SCOPES, type NestModule, type Registration, type Wrapper} from './model.js'

type Implementation = {id: string; label: string; data: Record<string, Json>; source?: unknown}

/** The registration's lifetime, as Nest's scope and whether its dependency tree is static decide it. */
function lifetimes(wrapper: Wrapper) {
  const scope = SCOPES[wrapper.scope ?? 0] ?? 'DEFAULT'
  const declared = scope === 'TRANSIENT' ? 'transient' : scope === 'REQUEST' ? 'scoped' : 'singleton'
  // A provider that injects a request-scoped one is itself re-created per request.
  const lifetime = declared === 'singleton' && !wrapper.isDependencyTreeStatic() ? 'scoped' : declared
  return {scope, declared, lifetime}
}

/** The class of a value provider's value, unless it is a built-in container class. */
function valueClass(wrapper: Wrapper): {name: string | undefined; constructor: unknown} {
  const constructor = (wrapper.instance as {constructor?: {name?: string}} | null | undefined)?.constructor
  const name =
    typeof constructor === 'function' && constructor.name && ![Object, Array, Map, Set, Function, Promise].includes(constructor as never)
      ? constructor.name
      : undefined
  return {name, constructor}
}

/** The `architecture/v0` entities and relationships of the kept modules, registrations and links. */
export class ArchitectureItems {
  readonly entities: Entity[] = []
  readonly relationships: Relationship[] = []

  constructor(
    private readonly classes: Map<unknown, string>,
    private readonly moduleKeys: Map<NestModule, string>,
    private readonly tokens: TokenIdentities,
  ) {}

  evidence(value: unknown): {evidence: Evidence[]} | Record<string, never> {
    const file = this.classes.get(value)
    return file ? {evidence: [{kind: 'nestjs', source: file}]} : {}
  }

  applicationModule = (module: NestModule): boolean => this.classes.has(module.metatype)

  addModules(modules: NestModule[], keptModules: Set<NestModule>, rootName: string): void {
    const moduleKeys = this.moduleKeys
    for (const module of modules) {
      if (!keptModules.has(module)) continue
      this.entities.push({
        id: `module:${moduleKeys.get(module)}`,
        kind: 'module',
        label: module.name,
        data: {
          global: module.isGlobal === true,
          origin: this.applicationModule(module) ? 'application' : 'framework',
          root: module.name === rootName && this.applicationModule(module),
        },
        ...this.evidence(module.metatype),
      })
      for (const imported of module.imports) {
        if (!imported || !keptModules.has(imported) || imported === module) continue
        // Nest adds every global module to every module's imports; only declared imports are boundaries.
        if (imported.isGlobal && !declaredImportsOf(module).has(imported.metatype)) continue
        this.relationships.push({
          id: `module:${moduleKeys.get(module)}:imports:${moduleKeys.get(imported)}`,
          kind: 'imports',
          from: `module:${moduleKeys.get(module)}`,
          to: `module:${moduleKeys.get(imported)}`,
          data: {reexported: module.exports.has(imported.metatype)},
        })
      }
    }
  }

  addRegistration(registration: Registration): void {
    const {wrapper, module, moduleKey} = registration
    const {tokenLabel, tokenId, tokenKind} = this.tokens
    const token = wrapper.token
    const exported = module.exports.has(token)
    this.entities.push({
      id: registration.service,
      kind: 'service',
      label: tokenLabel(token),
      data: {token: tokenId(token), tokenKind: tokenKind(token), module: moduleKey, exported},
      ...(typeof token === 'function' ? this.evidence(token) : {}),
    })
    const {scope, declared, lifetime} = lifetimes(wrapper)
    const kind = wrapper.isAlias ? 'alias' : wrapper.inject ? 'factory' : wrapper.metatype ? 'class' : 'value'
    const data: Record<string, Json> = {
      lifetime,
      scope,
      ordinal: 0,
      registrationKind: kind,
      module: moduleKey,
      exported,
      role: registration.role,
      origin: registration.application ? 'application' : 'framework',
    }
    if (lifetime !== declared) data.declaredLifetime = declared
    if (wrapper.durable) data.durable = true
    const implementation = this.implementation(registration, kind, data)
    this.entities.push({id: registration.registration, kind: 'registration', label: `${tokenLabel(token)} (${moduleKey})`, data})
    this.relationships.push({
      id: `${registration.registration}:binds`,
      kind: 'registration',
      from: registration.service,
      to: registration.registration,
    })
    this.relationships.push({
      id: `module:${moduleKey}:provides:${registration.registration}`,
      kind: 'provides',
      from: `module:${moduleKey}`,
      to: registration.registration,
    })
    if (implementation) {
      registration.implementation = implementation.id
      this.entities.push({
        id: implementation.id,
        kind: 'implementation',
        label: implementation.label,
        data: implementation.data,
        ...this.evidence(implementation.source),
      })
      this.relationships.push({
        id: `${registration.registration}:implements`,
        kind: 'implements',
        from: registration.registration,
        to: implementation.id,
      })
    }
  }

  /** What a registration provides: its class, its factory or its value's class; recorded in `data` too. */
  private implementation(registration: Registration, kind: string, data: Record<string, Json>): Implementation | undefined {
    const {wrapper, moduleKey} = registration
    const target = wrapper.metatype
    const id = `implementation:${moduleKey}:${this.tokens.tokenId(wrapper.token)}`
    if (kind === 'class' && typeof target === 'function') {
      data.implementation = target.name
      return {id, label: target.name, data: {type: target.name}, source: target}
    }
    if (kind === 'factory' && typeof target === 'function') {
      const name = target.name && target.name !== 'useFactory' ? target.name : 'useFactory'
      data.factory = name
      return {id, label: `${name}()`, data: {factory: name}}
    }
    if (kind !== 'value') return undefined
    const {name, constructor} = valueClass(wrapper)
    if (!name) return undefined
    data.implementation = name
    return {id, label: name, data: {type: name}, source: constructor}
  }

  addLink(link: Link): void {
    const dependency = link.dependency
    const requested = dependency ? this.tokens.tokenId(dependency.token) : undefined
    if (link.alias) {
      this.relationships.push({
        id: `${link.from.registration}:aliases`,
        kind: 'aliases',
        from: link.from.registration,
        to: link.to.service,
        confidence: link.confidence,
      })
      return
    }
    if (!link.from.implementation) return
    const injection = dependency?.injection ?? 'constructor'
    const data: Record<string, Json> = {injection, optional: dependency?.optional ?? false, collection: false}
    if (dependency?.parameter) data.parameter = dependency.parameter
    if (dependency && injection !== 'property') data.position = dependency.keyOrIndex
    if (requested) data.token = requested
    this.relationships.push({
      id: `${link.from.implementation}:dependsOn:${injection}:${String(dependency?.keyOrIndex ?? link.to.service)}`,
      kind: 'dependsOn',
      from: link.from.implementation,
      to: link.to.service,
      ...(dependency?.parameter ? {label: dependency.parameter} : {}),
      data,
      confidence: link.confidence,
    })
  }
}
