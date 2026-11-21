// The names a workspace package's entry points export that nothing imports.
import {existsSync, readFileSync} from 'node:fs'
import {join, posix} from 'node:path'
import type {Unit} from '../packages.ts'
import {readJson, walk} from '../repo.ts'
import {exportedNames, importsOf, skipped, sources} from './syntax.ts'

type Exports = string | {[condition: string]: Exports} | null

/** A package's entry points: `[subpath, source file]`, the source standing for its built JavaScript or types. */
export function entryPoints(root: string, unit: Unit): [string, string][] {
  const manifest = readJson<{exports?: Record<string, Exports> | string}>(root, `${unit.path}/package.json`) ?? {}
  const exports = typeof manifest.exports === 'string' ? {'.': manifest.exports} : (manifest.exports ?? {})
  const targetOf = (value: Exports): string | undefined =>
    typeof value === 'string'
      ? value
      : value
        ? (targetOf(value.import ?? null) ?? targetOf(value.default ?? null) ?? targetOf(value.types ?? null))
        : undefined
  const entries: [string, string][] = []
  for (const [subpath, value] of Object.entries(exports)) {
    const target = targetOf(value)
    if (!target || !/\.(?:[cm]?js|d\.ts|tsx?)$/.test(target)) continue
    const stem = posix
      .join(unit.path, target)
      .replace(/^(.*?)\/dist\//, '$1/src/')
      .replace(/(?:\.d)?\.(?:[cm]?js|ts|tsx)$/, '')
    const source = ['.ts', '.tsx', '.mts', '.js', '.mjs'].map(extension => stem + extension).find(path => existsSync(join(root, path)))
    if (source) entries.push([subpath, source])
  }
  return entries
}

/** Every file that may import a workspace package: this repository's sources, and any `--also` directories. */
function consumers(root: string, also: readonly string[]): string[] {
  return [root, ...also].flatMap(base =>
    walk(base, '.', path => !skipped.test(path))
      .filter(path => sources.test(path) && !path.endsWith('.d.ts'))
      .map(path => join(base, path)),
  )
}

export interface UnusedExports {
  entry: string
  names: string[]
}

/**
 * For each workspace, the names its entry points export that no other file imports. Entry points re-exported whole
 * (`export *` from the package, a namespace import or a dynamic import) count as used.
 */
export function unusedExports(root: string, units: readonly Unit[], also: readonly string[] = []): Map<string, UnusedExports[]> {
  const used = new Map<string, Set<string> | '*'>()
  for (const file of consumers(root, also)) {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const item of importsOf(file, text)) {
      if (item.specifier.startsWith('.') || item.specifier.startsWith('node:')) continue
      const current = used.get(item.specifier)
      if (current === '*') continue
      if (item.names === '*') used.set(item.specifier, '*')
      else used.set(item.specifier, new Set([...(current ?? []), ...item.names]))
    }
  }
  const report = new Map<string, UnusedExports[]>()
  for (const unit of units) {
    const name = unit.kinds.includes('npm') ? unit.names[0] : undefined
    if (!name || !existsSync(join(root, unit.path, 'package.json'))) continue
    const entries: UnusedExports[] = []
    for (const [subpath, source] of entryPoints(root, unit)) {
      const specifier = subpath === '.' ? name : `${name}${subpath.slice(1)}`
      const taken = used.get(specifier)
      if (taken === '*') continue
      const names = exportedNames(root, source).filter(exported => !taken?.has(exported))
      if (names.length) entries.push({entry: specifier, names: names.sort()})
    }
    if (entries.length) report.set(unit.path, entries)
  }
  return report
}
