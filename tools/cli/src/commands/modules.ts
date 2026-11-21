// `tools modules`: import cycles inside each workspace's source, and package exports nothing imports. A report for
// planning refactors; nothing here fails a gate.
import {resolve} from 'node:path'
import {loadUnits} from '../lib/packages.ts'
import {unusedExports} from '../lib/modules/exports.ts'
import {workspaceCycles} from '../lib/modules/cycles.ts'
import {TOOLS} from '../lib/gates.ts'
import {UsageError} from './work/change-set.ts'

export interface ModulesReport {
  workspaces: {path: string; cycles: string[][]; unusedExports: {entry: string; names: string[]}[]}[]
  note: string
  next: string[]
}

export function modulesReport(root: string, filter: string | undefined, also: readonly string[]): ModulesReport {
  const units = loadUnits(root).filter(unit => unit.kinds.includes('npm'))
  const selected = filter ? units.filter(unit => unit.path === filter || unit.path.startsWith(`${filter}/`)) : units
  if (filter && !selected.length) throw new UsageError(`No npm workspace at ${filter}`, `${TOOLS} map`)
  const unused = unusedExports(
    root,
    selected,
    also.map(path => resolve(root, path)),
  )
  const workspaces = selected
    .map(unit => ({path: unit.path, cycles: workspaceCycles(root, unit), unusedExports: unused.get(unit.path) ?? []}))
    .filter(entry => entry.cycles.length || entry.unusedExports.length)
  return {
    workspaces,
    note: 'Syntax only. An export nothing here imports may still be public API for other consumers: pass their directories with --also before removing one.',
    next: [`${TOOLS} explain <path>`],
  }
}
