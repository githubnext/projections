// Whether a workspace's build output (its dist) is there and newer than its src: TypeScript in the workspaces that
// depend on it reads that dist, so a fast typecheck and `doctor` need to know.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import type {Unit} from './packages.ts'
import {newestMtime, newestOutput} from './repo.ts'

export type BuildState = 'unbuilt' | 'stale' | 'current'

const checkedFile = (root: string) => join(root, 'node_modules', '.cache', 'projections-tools', 'checked-builds.json')

/**
 * When `tools build` last rebuilt each workspace and found its outputs unchanged (ms). It keeps those outputs' times,
 * so their src stays newer than them; this says they are current all the same.
 */
export function checkedTimes(root: string): Record<string, number> {
  try {
    return JSON.parse(readFileSync(checkedFile(root), 'utf8')) as Record<string, number>
  } catch {
    return {}
  }
}

export function recordChecked(root: string, path: string, time: number): void {
  const file = checkedFile(root)
  mkdirSync(dirname(file), {recursive: true})
  writeFileSync(file, `${JSON.stringify({...checkedTimes(root), [path]: time}, null, 2)}\n`)
}

/** The state of a workspace's dist, or undefined when it builds no dist from a src (a crate, a script-only workspace). */
export function buildState(root: string, unit: Unit, checked = checkedTimes(root)): BuildState | undefined {
  if (!unit.kinds.includes('npm') || !unit.scripts.includes('build') || !existsSync(join(root, unit.path, 'src'))) return undefined
  const output = newestOutput(root, `${unit.path}/dist`)
  if (output === undefined) return 'unbuilt'
  const source = newestMtime(root, `${unit.path}/src`)
  return source && source.mtime > Math.max(output, checked[unit.path] ?? 0) ? 'stale' : 'current'
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
