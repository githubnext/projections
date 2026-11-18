// Whether a workspace's build output (its dist) is there and newer than its src: TypeScript in the workspaces that
// depend on it reads that dist, so a fast typecheck and `doctor` need to know.
import {existsSync} from 'node:fs'
import {join} from 'node:path'
import type {Unit} from './packages.ts'
import {newestMtime, newestOutput} from './repo.ts'

export type BuildState = 'unbuilt' | 'stale' | 'current'

/** The state of a workspace's dist, or undefined when it builds no dist from a src (a crate, a script-only workspace). */
export function buildState(root: string, unit: Unit): BuildState | undefined {
  if (!unit.kinds.includes('npm') || !unit.scripts.includes('build') || !existsSync(join(root, unit.path, 'src'))) return undefined
  const output = newestOutput(root, `${unit.path}/dist`)
  if (output === undefined) return 'unbuilt'
  const source = newestMtime(root, `${unit.path}/src`)
  return source && source.mtime > output ? 'stale' : 'current'
}

/** The workspaces `unit` depends on, directly or transitively, in dependency order (dependencies first). */
export function dependenciesOf(units: readonly Unit[], unit: Unit): Unit[] {
  const byPath = new Map(units.map(entry => [entry.path, entry]))
  const ordered: Unit[] = []
  const seen = new Set<string>()
  const visit = (path: string) => {
    if (seen.has(path)) return
    seen.add(path)
    const entry = byPath.get(path)
    if (!entry) return
    for (const dependency of entry.dependsOn) visit(dependency)
    if (entry !== unit) ordered.push(entry)
  }
  visit(unit.path)
  return ordered
}
