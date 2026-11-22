import {parameterNames} from './parameters.js'
import {getMetadata, type Dependency, type NestModule, type Token, type Wrapper} from './model.js'

export function tokenOf(value: unknown): Token {
  if (typeof value === 'object' && value !== null && 'forwardRef' in value && typeof value.forwardRef === 'function') {
    return (value as {forwardRef: () => unknown}).forwardRef()
  }
  return value
}

/** A factory provider's `inject` list, by position. */
function factoryDependencies(target: unknown, inject: unknown[]): Dependency[] {
  const names = parameterNames(target, false)
  return inject.map((item, index) => {
    const optional = typeof item === 'object' && item !== null && 'token' in item && 'optional' in item && !('prototype' in item)
    const token = optional ? (item as {token: unknown}).token : item
    return {
      injection: 'factory' as const,
      keyOrIndex: index,
      token: tokenOf(token),
      optional: optional && (item as {optional: unknown}).optional === true,
      ...(names[index] ? {parameter: names[index]} : {}),
    }
  })
}

/** A class provider's constructor parameters, then its injected properties. */
function classDependencies(target: unknown): Dependency[] {
  const types = [...((getMetadata('design:paramtypes', target) as unknown[] | undefined) ?? [])]
  for (const {index, param} of (getMetadata('self:paramtypes', target) as {index: number; param: unknown}[] | undefined) ?? []) {
    types[index] = param
  }
  const optional = new Set((getMetadata('optional:paramtypes', target) as number[] | undefined) ?? [])
  const names = parameterNames(target, true)
  const dependencies: Dependency[] = types.map((type, index) => ({
    injection: 'constructor',
    keyOrIndex: index,
    token: tokenOf(type),
    optional: optional.has(index),
    ...(names[index] ? {parameter: names[index]} : {}),
  }))
  const optionalProperties = new Set((getMetadata('optional:properties_metadata', target) as unknown[] | undefined) ?? [])
  for (const property of (getMetadata('self:properties_metadata', target) as {key: string | symbol; type: unknown}[] | undefined) ?? []) {
    if (typeof property.key !== 'string') continue
    dependencies.push({
      injection: 'property',
      keyOrIndex: property.key,
      token: tokenOf(property.type),
      optional: optionalProperties.has(property.key),
      parameter: property.key,
    })
  }
  return dependencies
}

/** What a provider asks the container for, in Nest's own metadata. */
export function declaredDependencies(wrapper: Wrapper): Dependency[] {
  const target = wrapper.metatype
  if (!target) return []
  return wrapper.inject ? factoryDependencies(target, wrapper.inject) : classDependencies(target)
}

/** Nest's module-scoped lookup: the module's own providers, then what its imports export. */
export function lookup(module: NestModule, token: Token): [NestModule, Wrapper] | undefined {
  const own = module.providers.get(token)
  if (own) return [module, own]
  const visit = (current: NestModule, registry: Set<string>, traversing: boolean): [NestModule, Wrapper] | undefined => {
    let children = [...current.imports].filter(Boolean)
    if (traversing) children = children.filter(child => current.exports.has(child.metatype))
    for (const related of children) {
      if (registry.has(related.id)) continue
      registry.add(related.id)
      if (!related.exports.has(token) || !related.providers.has(token)) {
        const found = visit(related, registry, true)
        if (found) return found
        continue
      }
      return [related, related.providers.get(token)!]
    }
    return undefined
  }
  return visit(module, new Set(), false)
}

/** The module classes a module declares in `@Module({imports})`, dynamic modules by their class. */
export function declaredImportsOf(module: NestModule): Set<unknown> {
  return new Set(
    ((getMetadata('imports', module.metatype) as unknown[] | undefined) ?? [])
      .map(item => tokenOf(item))
      .map(item => (typeof item === 'object' && item !== null && 'module' in item ? item.module : item)),
  )
}
