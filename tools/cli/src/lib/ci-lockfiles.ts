// What a lockfile change reaches, for the CI plan's `lockfile` file rules (ci-files.ts): the workspaces and crates whose
// resolved dependencies changed, read from the lockfiles alone (no install, registry or network). package-lock.json's
// `packages` entries and Cargo.lock's `[[package]]` blocks, before and after, give the packages that changed and the
// graph that leads to them.
import {posix} from 'node:path'
import type {Unit} from './packages.ts'

export interface LockfileReach {
  /** Workspaces and crates whose dependencies, direct or transitive, changed. */
  units: string[]
  /** Whether the root package's own dependencies (the repository's tooling) changed. */
  root: boolean
}

interface Graph {
  entries: Map<string, string>
  edges: Map<string, string[]>
  members: Map<string, string>
}

function reach(before: Graph, after: Graph, root: string | undefined): LockfileReach {
  const keys = new Set([...before.entries.keys(), ...after.entries.keys()])
  const changed = new Set([...keys].filter(key => before.entries.get(key) !== after.entries.get(key)))
  const hits = (start: string) =>
    [before, after].some(graph => {
      const seen = new Set<string>()
      const queue = [start]
      while (queue.length) {
        const key = queue.pop()!
        if (seen.has(key)) continue
        seen.add(key)
        if (changed.has(key)) return true
        // Another workspace or crate: its own changes reach this one through the unit graph.
        for (const next of graph.edges.get(key) ?? []) if (!graph.members.has(next)) queue.push(next)
      }
      return false
    })
  const units = [...new Set([...before.members, ...after.members])].filter(([key]) => key !== root && hits(key)).map(([, unit]) => unit)
  return {units: [...new Set(units)].sort(), root: root !== undefined && hits(root)}
}

// ── npm ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface NpmEntry {
  link?: boolean
  resolved?: string
  [field: string]: unknown
}
const dependencyFields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']

/** Where `name` resolves from the package at `from`: its own node_modules, then each enclosing one, as Node looks. */
function resolveNpm(packages: Record<string, NpmEntry>, from: string, name: string): string | undefined {
  let directory = from
  for (;;) {
    const candidate = directory ? `${directory}/node_modules/${name}` : `node_modules/${name}`
    if (candidate in packages) return candidate
    if (!directory) return undefined
    const parent = directory.lastIndexOf('/node_modules/')
    directory = parent < 0 ? '' : directory.slice(0, parent)
  }
}

function npmGraph(text: string | undefined, units: readonly Unit[]): Graph {
  const packages = ((text ? JSON.parse(text) : {}) as {packages?: Record<string, NpmEntry>}).packages ?? {}
  const workspaces = new Set(units.filter(unit => unit.kinds.includes('npm')).map(unit => unit.path))
  const graph: Graph = {entries: new Map(), edges: new Map(), members: new Map()}
  for (const [key, entry] of Object.entries(packages)) {
    // A workspace's link stands for the workspace.
    const target = entry.link && entry.resolved && workspaces.has(entry.resolved) ? entry.resolved : undefined
    if (key === '' || workspaces.has(key)) graph.members.set(key, key)
    // The root entry also lists the workspaces; only its dependencies are the repository's tooling.
    const compared = key === '' ? Object.fromEntries(dependencyFields.map(field => [field, entry[field]])) : entry
    graph.entries.set(key, JSON.stringify(target ? {link: target} : compared))
    if (target) {
      graph.edges.set(key, [target])
      continue
    }
    const names = dependencyFields.flatMap(field => Object.keys((entry[field] as object | undefined) ?? {}))
    graph.edges.set(
      key,
      names.flatMap(name => resolveNpm(packages, key, name) ?? []),
    )
  }
  return graph
}

/** What a package-lock.json change reaches; `''` is the root package. */
export function npmLockfileReach(before: string | undefined, after: string | undefined, units: readonly Unit[]): LockfileReach {
  return reach(npmGraph(before, units), npmGraph(after, units), '')
}

// ── Cargo ───────────────────────────────────────────────────────────────────────────────────────────────────────────

interface CargoPackage {
  name: string
  version: string
  source: string | undefined
  dependencies: string[]
  text: string
}

export function parseCargoLock(text: string): CargoPackage[] {
  return text
    .split(/^\[\[package\]\]$/m)
    .slice(1)
    .map(block => {
      const field = (name: string) => new RegExp(`^${name} = "([^"]*)"`, 'm').exec(block)?.[1]
      const list = /^dependencies = \[([\s\S]*?)^\]/m.exec(block)?.[1] ?? ''
      return {
        name: field('name') ?? '',
        version: field('version') ?? '',
        source: field('source'),
        dependencies: [...list.matchAll(/"([^"]+)"/g)].map(match => match[1]!),
        text: block.trim(),
      }
    })
}

function cargoGraph(text: string | undefined, units: readonly Unit[]): Graph {
  const packages = text ? parseCargoLock(text) : []
  const key = (item: CargoPackage) => `${item.name} ${item.version}${item.source ? ` (${item.source})` : ''}`
  const crates = new Map(units.filter(unit => unit.kinds.includes('crate')).flatMap(unit => unit.names.map(name => [name, unit.path])))
  const graph: Graph = {entries: new Map(), edges: new Map(), members: new Map()}
  for (const item of packages) {
    graph.entries.set(key(item), item.text)
    const crate = item.source ? undefined : crates.get(item.name)
    if (crate) graph.members.set(key(item), crate)
    // `name`, `name version` or `name version (source)`: the package that matches all it gives.
    graph.edges.set(
      key(item),
      item.dependencies.flatMap(dependency => {
        const [, name, version, source] = /^(\S+)(?: (\S+))?(?: \((.+)\))?$/.exec(dependency) ?? []
        const found = packages.find(
          other => other.name === name && (!version || other.version === version) && (!source || other.source === source),
        )
        return found ? [key(found)] : []
      }),
    )
  }
  return graph
}

/** What a Cargo.lock change reaches. */
export function cargoLockfileReach(before: string | undefined, after: string | undefined, units: readonly Unit[]): LockfileReach {
  return reach(cargoGraph(before, units), cargoGraph(after, units), undefined)
}

/** The reach of a change to the lockfile at `path`, or undefined for a file that isn't one. */
export function lockfileReach(path: string, before: string | undefined, after: string | undefined, units: readonly Unit[]) {
  const name = posix.basename(path)
  if (name === 'package-lock.json') return npmLockfileReach(before, after, units)
  if (name === 'Cargo.lock') return cargoLockfileReach(before, after, units)
  return undefined
}
