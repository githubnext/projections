import {createRequire} from 'node:module'
import path from 'node:path'
import {compareIds} from '../values.js'
import {declaredImportsOf} from './metadata.js'
import {slash, within, type NestModule, type Token} from './model.js'

/** Classes exported by repository sources (not packages), with the file that defines them. */
export function applicationClasses(root: string): Map<unknown, string> {
  const classes = new Map<unknown, string>()
  const cache = createRequire(import.meta.url).cache
  for (const [file, module] of Object.entries(cache).sort(([a], [b]) => compareIds(a, b))) {
    if (!module || !within(root, file) || file.split(path.sep).includes('node_modules')) continue
    const exports = module.exports as unknown
    const values = typeof exports === 'function' ? [exports] : typeof exports === 'object' && exports !== null ? Object.values(exports) : []
    for (const value of values) if (typeof value === 'function' && !classes.has(value)) classes.set(value, slash(path.relative(root, file)))
  }
  return classes
}

export type TokenIdentities = ReturnType<typeof tokenIdentities>

/**
 * Stable token identities: class tokens by name (disambiguated by defining file),
 * string tokens by value and symbol tokens by description.
 */
export function tokenIdentities(modules: NestModule[], classes: Map<unknown, string>) {
  const byName = new Map<string, Set<unknown>>()
  const symbols = new Map<string, unknown[]>()
  for (const module of modules) {
    for (const wrapper of [...module.providers.values(), ...module.controllers.values()]) {
      const token = wrapper.token
      if (typeof token === 'function') byName.set(token.name, (byName.get(token.name) ?? new Set()).add(token))
      if (typeof token === 'symbol') {
        const list = symbols.get(token.description ?? '') ?? []
        if (!list.includes(token)) list.push(token)
        symbols.set(token.description ?? '', list)
      }
    }
  }
  const tokenLabel = (token: Token): string =>
    typeof token === 'function' ? token.name || '<anonymous class>' : typeof token === 'symbol' ? token.toString() : String(token)
  const tokenId = (token: Token): string => {
    if (typeof token === 'function') {
      const shared = (byName.get(token.name)?.size ?? 0) > 1
      return `class:${token.name}${shared ? `@${classes.get(token) ?? [...byName.get(token.name)!].indexOf(token)}` : ''}`
    }
    if (typeof token === 'symbol') {
      const list = symbols.get(token.description ?? '') ?? [token]
      return `symbol:${token.description ?? ''}${list.length > 1 ? `#${list.indexOf(token) + 1}` : ''}`
    }
    return `string:${String(token)}`
  }
  const tokenKind = (token: Token): string => (typeof token === 'function' ? 'class' : typeof token === 'symbol' ? 'symbol' : 'string')
  return {tokenLabel, tokenId, tokenKind}
}

/**
 * Module identities: the class name. A module class imported with several dynamic
 * configurations (`TypeOrmModule.forFeature`) is told apart by what does not
 * depend on scan order: the modules that import it, then what it provides, and
 * only then its position.
 */
export function moduleKeys(modules: NestModule[], coreProviders: Set<unknown>, tokenLabel: (token: Token) => string) {
  const keys = new Map<NestModule, string>()
  const byModuleName = new Map<string, NestModule[]>()
  for (const module of modules) byModuleName.set(module.name, [...(byModuleName.get(module.name) ?? []), module])
  const importers = (module: NestModule): string =>
    [
      ...new Set(
        modules
          .filter(
            other => other !== module && other.imports.has(module) && (!module.isGlobal || declaredImportsOf(other).has(module.metatype)),
          )
          .map(other => other.name),
      ),
    ]
      .sort(compareIds)
      .join('+')
  const provided = (module: NestModule): string =>
    [...module.providers.values()]
      .filter(wrapper => wrapper.token !== module.metatype && !coreProviders.has(wrapper.token))
      .map(wrapper => tokenLabel(wrapper.token))
      .sort(compareIds)
      .join(',')
  for (const [name, group] of byModuleName) {
    if (group.length === 1) {
      keys.set(group[0]!, name)
      continue
    }
    const named = group.map(module => `${name}@${importers(module)}`)
    const distinct = named.map((key, index) =>
      named.filter(other => other === key).length === 1 ? key : `${key}:${provided(group[index]!)}`,
    )
    const counts = new Map<string, number>()
    distinct.forEach((key, index) => {
      const count = (counts.get(key) ?? 0) + 1
      counts.set(key, count)
      keys.set(group[index]!, distinct.filter(other => other === key).length === 1 ? key : `${key}#${count}`)
    })
  }
  return keys
}
