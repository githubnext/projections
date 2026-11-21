// The package map: every npm workspace (the root package.json's `workspaces`) and every Cargo crate (Cargo.toml's
// `members`), described by its README and linked to the workspaces and crates it depends on.
import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {describe, type Description} from './markdown.ts'
import {expandMember, readJson, readText} from './repo.ts'

export type Kind = 'npm' | 'crate'

export interface Unit {
  /** Directory relative to the workspace root (POSIX). */
  path: string
  kinds: Kind[]
  /** The README's path, when there is one. */
  readme: string | undefined
  /** The npm package name and/or the crate name. */
  names: string[]
  description: string | undefined
  /** Where the description came from; `first-paragraph` is a fallback the README check rejects. */
  source: Description['source']
  /** Directories of the workspaces and crates this one depends on (dependencies and dev-dependencies). */
  dependsOn: string[]
  /** npm scripts this workspace defines. */
  scripts: string[]
}

interface Manifest {
  name?: string
  workspaces?: string[]
  dependencies?: object
  devDependencies?: object
  scripts?: object
}

export function npmWorkspaces(root: string): string[] {
  const manifest = readJson<Manifest>(root, 'package.json')
  return (manifest?.workspaces ?? []).flatMap(pattern => expandMember(root, pattern, 'package.json'))
}

/** `members = [...]` of the root Cargo.toml's `[workspace]`. */
export function cargoMembers(root: string): string[] {
  const text = readText(root, 'Cargo.toml')
  if (!text) return []
  const members = /\[workspace\][\s\S]*?\bmembers\s*=\s*\[([\s\S]*?)\]/.exec(text)?.[1] ?? ''
  return [...members.matchAll(/"([^"]+)"/g)].flatMap(match => expandMember(root, match[1]!, 'Cargo.toml'))
}

/** A crate's `[package] name` and the relative paths of its path dependencies (every dependency table). */
export function parseCrate(text: string): {name: string | undefined; paths: string[]} {
  const name = /\[package\][^[]*?\bname\s*=\s*"([^"]+)"/.exec(text)?.[1]
  // Dependencies with a path are inline tables (`name = { path = "../x" }`); `[[bin]] path = ...` lines are not.
  const paths = [...text.matchAll(/^\s*[\w-]+\s*=\s*\{[^}\n]*\bpath\s*=\s*"([^"]+)"/gm)].map(match => match[1]!)
  return {name, paths}
}

function joinPath(base: string, relativePath: string): string {
  const parts = base.split('/')
  for (const part of relativePath.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.' && part !== '') parts.push(part)
  }
  return parts.join('/')
}

export function loadUnits(root: string): Unit[] {
  const units = new Map<string, Unit>()
  const unit = (path: string): Unit => {
    let found = units.get(path)
    if (!found) {
      const readme = existsSync(join(root, path, 'README.md')) ? readText(root, `${path}/README.md`) : undefined
      const {description, source} = describe(readme)
      found = {
        path,
        kinds: [],
        names: [],
        readme: readme === undefined ? undefined : `${path}/README.md`,
        description,
        source,
        dependsOn: [],
        scripts: [],
      }
      units.set(path, found)
    }
    return found
  }
  const npmByName = new Map<string, string>()
  const npmDependencies = new Map<string, string[]>()
  for (const path of npmWorkspaces(root)) {
    const manifest = readJson<Manifest>(root, `${path}/package.json`) ?? {}
    const entry = unit(path)
    entry.kinds.push('npm')
    if (manifest.name) {
      entry.names.push(manifest.name)
      npmByName.set(manifest.name, path)
    }
    entry.scripts = Object.keys(manifest.scripts ?? {}).sort()
    npmDependencies.set(path, Object.keys({...manifest.dependencies, ...manifest.devDependencies}))
  }
  const crates = cargoMembers(root)
  const crateDependencies = new Map<string, string[]>()
  for (const path of crates) {
    const {name, paths} = parseCrate(readText(root, `${path}/Cargo.toml`) ?? '')
    const entry = unit(path)
    entry.kinds.push('crate')
    if (name && !entry.names.includes(name)) entry.names.push(name)
    crateDependencies.set(
      path,
      paths.map(dependency => joinPath(path, dependency)),
    )
  }
  for (const [path, names] of npmDependencies) {
    const entry = units.get(path)!
    for (const name of names) {
      const dependency = npmByName.get(name)
      if (dependency && dependency !== path) entry.dependsOn.push(dependency)
    }
    // A workspace inside a crate's directory builds that crate (packages/engine/js compiles the engine to Wasm).
    for (const crate of crates) if (crate !== path && path.startsWith(`${crate}/`)) entry.dependsOn.push(crate)
  }
  for (const [path, dependencies] of crateDependencies) {
    const entry = units.get(path)!
    for (const dependency of dependencies) if (units.has(dependency) && dependency !== path) entry.dependsOn.push(dependency)
  }
  for (const entry of units.values()) entry.dependsOn = [...new Set(entry.dependsOn)].sort()
  return [...units.values()].sort((a, b) => a.path.localeCompare(b.path))
}

/** The unit owning a path: the one whose directory is its longest prefix. */
export function ownerOf(units: readonly Unit[], path: string): Unit | undefined {
  let owner: Unit | undefined
  for (const unit of units) {
    if ((path === unit.path || path.startsWith(`${unit.path}/`)) && (!owner || unit.path.length > owner.path.length)) owner = unit
  }
  return owner
}

/** Finds a unit by directory, npm name or crate name. */
export function findUnit(units: readonly Unit[], target: string): Unit | undefined {
  const normalized = target.replace(/^\.\//, '').replace(/\/$/, '')
  return units.find(unit => unit.path === normalized || unit.names.includes(normalized))
}

/** Every unit that depends, directly or transitively, on one of `paths` (not including them). */
export function dependantsOf(units: readonly Unit[], paths: Iterable<string>): string[] {
  const reverse = new Map<string, string[]>()
  for (const unit of units) {
    for (const dependency of unit.dependsOn) reverse.set(dependency, [...(reverse.get(dependency) ?? []), unit.path])
  }
  const start = new Set(paths)
  const seen = new Set<string>()
  const queue = [...start]
  while (queue.length) {
    for (const dependant of reverse.get(queue.shift()!) ?? []) {
      if (!seen.has(dependant) && !start.has(dependant)) {
        seen.add(dependant)
        queue.push(dependant)
      }
    }
  }
  return [...seen].sort()
}

/** Units in dependency order (dependencies first), limited to `paths`. */
export function inDependencyOrder(units: readonly Unit[], paths: Iterable<string>): string[] {
  const wanted = new Set(paths)
  const byPath = new Map(units.map(unit => [unit.path, unit]))
  const ordered: string[] = []
  const done = new Set<string>()
  const visit = (path: string, stack: Set<string>) => {
    if (done.has(path) || stack.has(path)) return
    stack.add(path)
    for (const dependency of byPath.get(path)?.dependsOn ?? []) visit(dependency, stack)
    stack.delete(path)
    done.add(path)
    if (wanted.has(path)) ordered.push(path)
  }
  for (const path of [...wanted].sort()) visit(path, new Set())
  return ordered
}

/** Workspace and crate READMEs without a front matter `description`. */
export function readmeProblems(units: readonly Unit[]): {file: string; line: number; message: string}[] {
  return units
    .filter(unit => unit.source !== 'front-matter')
    .map(unit => ({
      file: `${unit.path}/README.md`,
      line: 1,
      message:
        unit.readme === undefined
          ? `${unit.kinds.join(' and ')} ${unit.names[0] ?? unit.path} has no README.md with a front matter description`
          : 'README.md has no front matter description (add `---\\ndescription: …\\n---` above the title)',
    }))
}
