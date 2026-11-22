// Whether a workspace's build output (its dist) is there, complete and current with its inputs: TypeScript in the
// workspaces that depend on it reads that dist, so a fast typecheck, `build` and `doctor` need to know.
import {createHash} from 'node:crypto'
import {existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs'
import {dirname, join, relative, sep} from 'node:path'
import type {Unit} from './packages.ts'
import {newestOutput} from './repo.ts'

/** `incomplete`: a `tools build` of it started and didn't succeed, so its outputs may be partial whatever their times. */
export type BuildState = 'unbuilt' | 'stale' | 'incomplete' | 'current'

export type BuildStatus = {state: 'current'} | {state: Exclude<BuildState, 'current'>; reason: string}

/**
 * What `tools build` knows beyond file times, per workspace: `checked`, when it last rebuilt the workspace and found
 * its outputs unchanged (ms; it keeps those outputs' old times, so this says they are current all the same),
 * `building`, set while a build runs and cleared only when it succeeds, and from its last successful build the
 * signature of its build inputs besides its src (`inputs`, see `inputSignature`), the files it produced (`outputs`,
 * relative to the workspace) and when it recorded them (`recorded`, ms).
 */
export interface BuildRecord {
  checked?: number
  building?: boolean
  inputs?: string
  outputs?: string[]
  recorded?: number
}

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

const posix = (path: string) => path.split(sep).join('/')
const isFile = (path: string) => existsSync(path) && statSync(path).isFile()

/** Configuration at a workspace's top level that its build reads: its manifest, tsconfigs and tool configs. */
const configFile = /^(package\.json|tsconfig.*\.json|.+\.config\.[cm]?[jt]s)$/

/**
 * A workspace's build inputs besides its src, as paths from the root, sorted: its manifest, tsconfigs and the
 * shared ones they extend, its tool configs (vite, vitest, tsdown…), its scripts directory, and the files its build
 * scripts (and the npm scripts they run) name.
 */
export function buildInputs(root: string, unit: Unit): string[] {
  const directory = join(root, unit.path)
  const inputs = new Set<string>()
  const add = (path: string) => inputs.add(posix(relative(root, path)))
  const tsconfigs: string[] = []
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    if (entry.isFile() && configFile.test(entry.name)) {
      add(join(directory, entry.name))
      if (entry.name.startsWith('tsconfig')) tsconfigs.push(join(directory, entry.name))
    }
  }
  // Relative `extends` only: a package's tsconfig is a dependency, which the lockfile versions.
  while (tsconfigs.length) {
    const tsconfig = tsconfigs.pop()!
    const extended = /"extends"\s*:\s*("[^"]*"|\[[^\]]*\])/.exec(readFileSync(tsconfig, 'utf8'))?.[1] ?? ''
    for (const [, name] of extended.matchAll(/"(\.{1,2}\/[^"]*)"/g)) {
      const path = join(dirname(tsconfig), name!.endsWith('.json') ? name! : `${name}.json`)
      if (isFile(path) && !inputs.has(posix(relative(root, path)))) {
        add(path)
        tsconfigs.push(path)
      }
    }
  }
  const visit = (path: string) => {
    for (const entry of readdirSync(path, {withFileTypes: true})) {
      if (entry.isDirectory() && entry.name !== 'node_modules') visit(join(path, entry.name))
      else if (entry.isFile()) add(join(path, entry.name))
    }
  }
  if (existsSync(join(directory, 'scripts'))) visit(join(directory, 'scripts'))
  const manifest = join(directory, 'package.json')
  const scripts = isFile(manifest) ? ((JSON.parse(readFileSync(manifest, 'utf8')) as {scripts?: Record<string, string>}).scripts ?? {}) : {}
  const queue = ['prebuild', 'build', 'postbuild']
  for (const name of queue) {
    const script = scripts[name]
    if (script === undefined) continue
    for (const [, run] of script.matchAll(/\bnpm run ([\w:.-]+)/g)) {
      for (const next of [`pre${run}`, run!, `post${run}`]) if (!queue.includes(next)) queue.push(next)
    }
    for (const token of script.split(/[\s"'\x60=;&|()<>]+/)) {
      if (!/[./]/.test(token) || token.startsWith('-')) continue
      const path = join(directory, token)
      // What the build writes is not an input to it.
      const within = posix(relative(directory, path))
      if (/^(dist|artifacts|node_modules)(\/|$)/.test(within) || !isFile(path)) continue
      add(path)
    }
  }
  return [...inputs].sort()
}

/** The content signature of the files `buildInputs` lists: a build is current only with the inputs it was built from. */
export function inputSignature(root: string, inputs: readonly string[]): string {
  const hash = createHash('sha256')
  for (const input of inputs) {
    const content = readFileSync(join(root, input))
    hash.update(`${input}\0${content.length}\0`).update(content)
  }
  return hash.digest('hex')
}

/** When a workspace's outputs were last known current: their newest time, or a later check that found them unchanged. */
export function outputTime(root: string, unit: Unit, records = buildRecords(root)): number | undefined {
  const output = newestOutput(root, `${unit.path}/dist`)
  return output === undefined ? undefined : Math.max(output, records[unit.path]?.checked ?? 0)
}

/**
 * The state of a workspace's dist and, unless it is current, why; undefined when it builds no dist from a src (a
 * crate, a script-only workspace). With a signature from its last `tools build`, its inputs besides src must match it
 * and the outputs that build produced must all still be there. Without one, or when its outputs were written since
 * (by `npm run build`), those inputs must be older than its dist, as its src must be either way.
 */
export function buildStatus(root: string, unit: Unit, records = buildRecords(root)): BuildStatus | undefined {
  if (!unit.kinds.includes('npm') || !unit.scripts.includes('build') || !existsSync(join(root, unit.path, 'src'))) return undefined
  const output = outputTime(root, unit, records)
  if (output === undefined) return {state: 'unbuilt', reason: 'not built'}
  const record = records[unit.path]
  if (record?.building) return {state: 'incomplete', reason: 'its last build did not finish'}
  if (newestSource(root, `${unit.path}/src`) > output) return {state: 'stale', reason: 'src is newer than dist'}
  const inputs = buildInputs(root, unit)
  const written = newestOutput(root, `${unit.path}/dist`) ?? 0
  if (record?.inputs === undefined || record.recorded === undefined || written > record.recorded) {
    const newer = inputs.find(input => statSync(join(root, input)).mtimeMs > output)
    return newer ? {state: 'stale', reason: `${newer} is newer than dist`} : {state: 'current'}
  }
  if (inputSignature(root, inputs) !== record.inputs) return {state: 'stale', reason: 'its build inputs changed since its last build'}
  const missing = record.outputs?.find(path => !existsSync(join(root, unit.path, path)))
  return missing ? {state: 'stale', reason: `${unit.path}/${missing} is missing`} : {state: 'current'}
}

/** The state of a workspace's dist, or undefined when it builds no dist from a src (a crate, a script-only workspace). */
export function buildState(root: string, unit: Unit, records = buildRecords(root)): BuildState | undefined {
  return buildStatus(root, unit, records)?.state
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
