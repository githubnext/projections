// Commands the gates share, and the plans of the two gates that read type information (typecheck and lint), which
// wait for the dependencies' built declarations.
import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {buildState} from './builds.ts'
import type {GateContext, Plan} from './gates.ts'
import {TOOLS} from './invocation.ts'
import {inDependencyOrder, type Unit} from './packages.ts'
import type {Command} from './repo.ts'

export const npm = (...argv: string[]): Command => ({argv: ['npm', ...argv]})
export const npx = (...argv: string[]): Command => ({argv: ['npx', '--no-install', ...argv]})

export const changedFiles = (context: GateContext, pattern: RegExp) =>
  (context.files ?? []).filter(path => pattern.test(path) && existsSync(join(context.root, path)))

/**
 * The units whose dependencies' dist is current, and a note naming the rest. Type information comes from a
 * dependency's built declarations, so a workspace whose dependency is unbuilt, or older than its src, would be checked
 * against stale types: it waits for a build.
 */
function withCurrentDependencies(context: GateContext, units: readonly Unit[]): {ready: Unit[]; note?: string} {
  const waiting: string[] = []
  const ready = units.filter(unit => {
    const outdated = unit.dependsOn.filter(path => {
      const dependency = context.units.find(entry => entry.path === path)
      const state = dependency && buildState(context.root, dependency)
      return state !== undefined && state !== 'current'
    })
    if (outdated.length) waiting.push(`${unit.path} (${outdated.join(', ')} unbuilt, unfinished or older than its src)`)
    return !outdated.length
  })
  return waiting.length ? {ready, note: `not checked until ${TOOLS} build <workspace>: ${waiting.join('; ')}`} : {ready}
}

/** `check --fast`'s typecheck: the changed workspaces only, against their dependencies' current dist. */
export function fastTypecheck(context: GateContext): Plan {
  const changed = new Set(context.affected?.changed ?? [])
  const units = inDependencyOrder(context.units, changed)
    .map(path => context.units.find(unit => unit.path === path) as Unit)
    .filter(unit => unit.kinds.includes('npm') && unit.scripts.includes('typecheck'))
  if (!units.length) return {skip: 'no changed workspace has a typecheck script'}
  const {ready, note} = withCurrentDependencies(context, units)
  if (!ready.length) return {skip: note as string}
  return {commands: ready.map(unit => npm('run', 'typecheck', '--workspace', unit.names[0] as string)), ...(note ? {note} : {})}
}

/** The npm workspace a repository path belongs to: the deepest one holding it. */
const workspaceOf = (context: GateContext, path: string) =>
  context.units
    .filter(unit => unit.kinds.includes('npm') && path.startsWith(`${unit.path}/`))
    .sort((left, right) => right.path.length - left.path.length)[0]

/**
 * The lint gate. Everything: npm run lint, a process per workspace. --affected: the changed and dependent workspaces
 * (a changed type can break a dependant's type-aware rules) and the changed files outside every workspace. --fast: only
 * the changed files, those in a workspace only when its dependencies' dist is current, as for the typecheck.
 */
export function lintPlan(context: GateContext): Plan {
  if (!context.affected) return {commands: [npm('run', '--silent', 'lint')]}
  const files = changedFiles(context, /\.([cm]?[jt]sx?)$/)
  const outside = files.filter(path => !workspaceOf(context, path))
  const eslint = (...paths: string[]) => npx('eslint', '--quiet', '--no-warn-ignored', ...paths)
  if (!context.fast) {
    const units = inDependencyOrder(context.units, [...context.affected.changed, ...context.affected.dependants])
      .map(path => context.units.find(unit => unit.path === path) as Unit)
      .filter(unit => unit.kinds.includes('npm'))
    const commands = [...units.map(unit => eslint(unit.path)), ...(outside.length ? [eslint(...outside)] : [])]
    return commands.length ? {commands} : {skip: 'no TypeScript or JavaScript changed'}
  }
  if (!files.length) return {skip: 'no TypeScript or JavaScript changed'}
  const changedUnits = [...new Set(files.map(path => workspaceOf(context, path)).filter(unit => unit !== undefined))]
  const {ready, note} = withCurrentDependencies(context, changedUnits)
  const checked = [...outside, ...files.filter(path => ready.includes(workspaceOf(context, path) as Unit))]
  if (!checked.length) return {skip: note as string}
  return {commands: [eslint(...checked)], ...(note ? {note} : {})}
}
