// Whether a workspace's build output (its dist) is there, complete and newer than its src: TypeScript in the workspaces
// that depend on it reads that dist, so a fast typecheck, `build` and `doctor` need to know.
import {existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import type {Unit} from './packages.ts'
import {newestOutput} from './repo.ts'

/** `incomplete`: a `tools build` of it started and didn't succeed, so its outputs may be partial whatever their times. */
export type BuildState = 'unbuilt' | 'stale' | 'incomplete' | 'current'

/**
 * What `tools build` knows beyond file times, per workspace: `checked`, when it last rebuilt the workspace and found
 * its outputs unchanged (ms; it keeps those outputs' old times, so this says they are current all the same), and
 * `building`, set while a build runs and cleared only when it succeeds.
 */
export type BuildRecord = {checked?: number; building?: boolean}

const recordsFile = (root: string) => join(root, 'node_modules', '.cache', 'projections-tools', 'builds.json')

export function buildRecords(root: string): Record<string, BuildRecord> {
  try {
    return JSON.parse(readFileSync(recordsFile(root), 'utf8')) as Record<string, BuildRecord>
  } catch {
    return {}
  }
}

export function recordBuild(root: string, path: string, record: BuildRecord): void {
  const file = recordsFile(root)
  mkdirSync(dirname(file), {recursive: true})
  writeFileSync(file, `${JSON.stringify({...buildRecords(root), [path]: record}, null, 2)}\n`)
}

/**
 * The newest modification time under a source directory, its directories' own included: deleting or renaming a file
 * changes only its directory's time, and a build must see that as much as an edit.
 */
export function newestSource(root: string, directory: string): number {
  let newest = 0
  const visit = (path: string) => {
    newest = Math.max(newest, statSync(path).mtimeMs)
    for (const entry of readdirSync(path, {withFileTypes: true})) {
      if (entry.isDirectory()) visit(join(path, entry.name))
      else if (entry.isFile()) newest = Math.max(newest, statSync(join(path, entry.name)).mtimeMs)
    }
  }
  visit(join(root, directory))
  return newest
}

/** When a workspace's outputs were last known current: their newest time, or a later check that found them unchanged. */
export function outputTime(root: string, unit: Unit, records = buildRecords(root)): number | undefined {
  const output = newestOutput(root, `${unit.path}/dist`)
  return output === undefined ? undefined : Math.max(output, records[unit.path]?.checked ?? 0)
}

/** The state of a workspace's dist, or undefined when it builds no dist from a src (a crate, a script-only workspace). */
export function buildState(root: string, unit: Unit, records = buildRecords(root)): BuildState | undefined {
  if (!unit.kinds.includes('npm') || !unit.scripts.includes('build') || !existsSync(join(root, unit.path, 'src'))) return undefined
  const output = outputTime(root, unit, records)
  if (output === undefined) return 'unbuilt'
  if (records[unit.path]?.building) return 'incomplete'
  return newestSource(root, `${unit.path}/src`) > output ? 'stale' : 'current'
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
