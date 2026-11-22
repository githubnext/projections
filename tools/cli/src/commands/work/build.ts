// `build`: a workspace and the workspaces it needs, rebuilding only what is out of date. `npm run build` rebuilds
// every workspace, including the release CLI and Storybook; this rebuilds a dependency only when it was never built,
// its src or other build inputs changed since (`buildStatus`), or a dependency of its own was rebuilt or is newer, as
// make would.
import {createHash} from 'node:crypto'
import {existsSync, readdirSync, readFileSync, statSync, utimesSync} from 'node:fs'
import {join, relative, sep} from 'node:path'
import {bound, TOOLS} from '../../lib/gates.ts'
import {
  buildInputs,
  buildRecords,
  buildStatus,
  changeTime,
  dependenciesOf,
  inputsChanged,
  inputSignature,
  outputTime,
  recordBuild,
} from '../../lib/builds.ts'
import {findUnit, inDependencyOrder, loadUnits, type Unit} from '../../lib/packages.ts'
import {parseProblems, tail, type Problem} from '../../lib/problems.ts'
import {run} from '../../lib/repo.ts'
import {changeSet, UsageError} from './change-set.ts'

export interface BuildOptions {
  target?: string | undefined
  affected?: boolean | undefined
  since?: string | undefined
  force?: boolean | undefined
  dryRun?: boolean | undefined
  limit?: number | undefined
}

export interface BuildStep {
  workspace: string
  status: 'built' | 'unchanged' | 'current' | 'planned' | 'failed' | 'skip'
  reason: string
  seconds?: number
  problems?: Problem[]
  moreProblems?: number
  tail?: string[]
}

interface Times {
  atime: Date
  mtime: Date
}

/**
 * A workspace's build outputs: every file under its dist and artifacts with its content hash and times, and every
 * directory with its times. Watchers such as Cargo's `rerun-if-changed` on a directory read directories' times too,
 * and a build that empties and refills one changes them.
 */
interface Snapshot {
  files: Map<string, Times & {hash: string}>
  directories: Map<string, Times>
}

export function snapshot(root: string, unit: Unit): Snapshot {
  const taken: Snapshot = {files: new Map(), directories: new Map()}
  const visit = (directory: string) => {
    const {atime, mtime} = statSync(directory)
    taken.directories.set(directory, {atime, mtime})
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) {
        const stats = statSync(path)
        taken.files.set(path, {hash: createHash('sha256').update(readFileSync(path)).digest('hex'), atime: stats.atime, mtime: stats.mtime})
      }
    }
  }
  for (const output of ['dist', 'artifacts']) if (existsSync(join(root, unit.path, output))) visit(join(root, unit.path, output))
  return taken
}

/**
 * When a build wrote the same outputs again, puts their times back, so what depends on them stays current; a build
 * that always runs (one Cargo keeps current) then rebuilds nothing above it. True when nothing changed.
 */
export function restoreIfUnchanged(before: Snapshot, after: Snapshot): boolean {
  if (!before.files.size || before.files.size !== after.files.size || before.directories.size !== after.directories.size) return false
  for (const [path, file] of after.files) if (before.files.get(path)?.hash !== file.hash) return false
  for (const path of after.directories.keys()) if (!before.directories.has(path)) return false
  for (const [path, file] of before.files) utimesSync(path, file.atime, file.mtime)
  // Deepest first: setting a directory's times doesn't touch its parent's, but keep the order obvious.
  for (const [path, times] of [...before.directories].toSorted((a, b) => b[0].length - a[0].length)) {
    utimesSync(path, times.atime, times.mtime)
  }
  return true
}

/**
 * Records a successful build of `unit` from inputs with signature `inputs`, along with the outputs it produced; when
 * they came out unchanged, puts their times back and records when it checked. True when they did.
 */
export function recordSuccess(root: string, unit: Unit, inputs: string, before: Snapshot, started: number): boolean {
  const after = snapshot(root, unit)
  const unchanged = restoreIfUnchanged(before, after)
  const outputs = [...after.files.keys()].map(path => relative(join(root, unit.path), path).split(sep).join('/')).toSorted()
  const previous = buildRecords(root)[unit.path]
  const changed = inputsChanged(previous, inputs) ? started : previous?.changed
  recordBuild(root, unit.path, {
    ...(unchanged ? {checked: started} : {}),
    ...(changed === undefined ? {} : {changed}),
    inputs,
    outputs,
    recorded: Date.now(),
  })
  return unchanged
}

const builds = (unit: Unit | undefined): boolean => Boolean(unit?.kinds.includes('npm') && unit.scripts.includes('build'))

/** Why `unit` needs building, or undefined when its dist is current. `rebuilt` holds the workspaces built this run. */
export function staleness(root: string, units: readonly Unit[], unit: Unit, rebuilt: ReadonlySet<string>): string | undefined {
  // Cargo decides for itself what a Rust build needs; outside the workspace's directory, too.
  if (unit.kinds.includes('crate') || unit.dependsOn.some(path => units.find(entry => entry.path === path)?.kinds.includes('crate'))) {
    return 'builds Rust, which Cargo keeps current'
  }
  const records = buildRecords(root)
  const status = buildStatus(root, unit, records)
  if (status === undefined) return 'has no src and dist to compare'
  if (status.state !== 'current') return status.reason
  const changed = unit.dependsOn.find(path => rebuilt.has(path))
  if (changed) return `${changed} was rebuilt`
  const output = outputTime(root, unit, records) ?? 0
  const newer = unit.dependsOn.find(path => builds(units.find(entry => entry.path === path)) && changeTime(root, path, records) > output)
  return newer ? `${newer} was built after it` : undefined
}

export async function buildReport(root: string, options: BuildOptions, progress?: (line: string) => void) {
  const units = loadUnits(root)
  let targets: Unit[]
  if (options.target) {
    const unit = findUnit(units, options.target)
    if (!unit) throw new UsageError(`No workspace ${options.target}`, `${TOOLS} map lists them`)
    if (!builds(unit) && !unit.dependsOn.length) throw new UsageError(`${unit.path} has no build script and no dependencies to build`)
    targets = [unit]
  } else if (options.affected || options.since !== undefined) {
    const set = changeSet(root, options.since)
    targets = set.affected.changed.map(path => units.find(unit => unit.path === path)!).filter(unit => unit.kinds.includes('npm'))
  } else {
    throw new UsageError('Name a workspace, or pass --affected', `${TOOLS} build packages/renderers/graph; npm run build builds everything`)
  }
  const wanted = new Set(targets.map(unit => unit.path))
  const closure = new Set<string>()
  for (const target of targets) {
    closure.add(target.path)
    for (const dependency of dependenciesOf(units, target)) closure.add(dependency.path)
  }
  const order = inDependencyOrder(units, closure)
    .map(path => units.find(unit => unit.path === path)!)
    .filter(builds)
  const steps: BuildStep[] = []
  const rebuilt = new Set<string>()
  let failed = false
  for (const unit of order) {
    if (failed) {
      steps.push({workspace: unit.path, status: 'skip', reason: 'an earlier build failed'})
      continue
    }
    const reason = options.force
      ? 'forced'
      : wanted.has(unit.path)
        ? 'asked for'
        : staleness(
            root,
            units,
            unit,
            options.dryRun ? new Set(steps.filter(step => step.status === 'planned').map(step => step.workspace)) : rebuilt,
          )
    if (!reason) {
      steps.push({workspace: unit.path, status: 'current', reason: 'dist is current with its inputs and dependencies'})
      continue
    }
    if (options.dryRun) {
      steps.push({workspace: unit.path, status: 'planned', reason})
      continue
    }
    progress?.(`▸ ${unit.path}: ${reason}`)
    const before = snapshot(root, unit)
    const started = Date.now()
    // The inputs it is built from: one edited while it builds leaves it stale.
    const inputs = inputSignature(root, buildInputs(root, unit))
    // Until it succeeds: a build that fails part way can leave outputs newer than their src.
    const previous = buildRecords(root)[unit.path] ?? {}
    recordBuild(root, unit.path, {...previous, building: true})
    const ran = await run(root, {argv: ['npm', 'run', 'build', '--workspace', unit.names[0]!]})
    const seconds = Math.round(ran.durationMs / 100) / 10
    if (ran.exitCode === 0) {
      const unchanged = recordSuccess(root, unit, inputs, before, started)
      // Unchanged outputs from changed inputs still change what a dependant reads of it (see `BuildRecord.changed`).
      if (!unchanged || inputsChanged(previous, inputs)) rebuilt.add(unit.path)
      progress?.(`  ${unchanged ? 'unchanged' : 'built'} (${Math.round(ran.durationMs / 1000)}s)`)
      steps.push({workspace: unit.path, status: unchanged ? 'unchanged' : 'built', reason, seconds})
      continue
    }
    progress?.(`  failed (${Math.round(ran.durationMs / 1000)}s)`)
    failed = true
    const problems = parseProblems(ran.output, root, unit.path)
    steps.push({
      workspace: unit.path,
      status: 'failed',
      reason,
      seconds,
      ...bound(problems, options.limit ?? 8),
      ...(problems.length ? {} : {tail: ran.missing ? [`${ran.missing} is not installed`] : tail(ran.output, 15)}),
    })
  }
  const notes = targets.length ? [] : ['No workspace changed.']
  const first = steps.find(step => step.status === 'failed')?.problems?.find(problem => problem.file)?.file
  return {
    status: failed ? ('fail' as const) : ('pass' as const),
    steps,
    notes,
    next: failed
      ? [...(first ? [`${TOOLS} explain ${first}`] : []), `${TOOLS} build ${options.target ?? '--affected'}`]
      : options.dryRun
        ? [`${TOOLS} build ${options.target ?? '--affected'}`]
        : [...targets.slice(0, 3).map(unit => `${TOOLS} test ${unit.path}`), `${TOOLS} check --affected`],
  }
}
