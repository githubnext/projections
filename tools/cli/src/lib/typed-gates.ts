// Commands the gates share, and the plans of the two gates that read type information (typecheck and lint), which
// wait for the dependencies' built declarations.
import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {buildRecords, buildState, dependenciesOf, outputTime} from './builds.ts'
import type {GateContext, Plan} from './gates.ts'
import {TOOLS} from './invocation.ts'
import {inDependencyOrder, type Unit} from './packages.ts'
import {newestOutput, type Command} from './repo.ts'

export const npm = (...argv: string[]): Command => ({argv: ['npm', ...argv]})
export const npx = (...argv: string[]): Command => ({argv: ['npx', '--no-install', ...argv]})

export const changedFiles = (context: GateContext, pattern: RegExp) =>
  (context.files ?? []).filter(path => pattern.test(path) && existsSync(join(context.root, path)))

/**
 * The workspaces `unit` depends on, directly or transitively, whose dist isn't current: unbuilt, unfinished, older
 * than its own src or build inputs, or older than the dist of a workspace it depends on (built since, so its
 * declarations may describe the old one), as `tools build` decides.
 */
function outdatedDependencies(context: GateContext, unit: Unit): string[] {
  const records = buildRecords(context.root)
  const byPath = new Map(context.units.map(entry => [entry.path, entry]))
  return dependenciesOf(context.units, unit)
    .filter(dependency => {
      const state = buildState(context.root, dependency, records)
      if (state === undefined) return false
      if (state !== 'current') return true
      const output = outputTime(context.root, dependency, records) ?? 0
      return dependency.dependsOn.some(path => {
        const built = byPath.get(path)
        return (
          built !== undefined &&
          buildState(context.root, built, records) !== undefined &&
          (newestOutput(context.root, `${path}/dist`) ?? 0) > output
        )
      })
    })
    .map(dependency => dependency.path)
}

/**
 * The units whose dependencies' dist is current, and a note naming the rest. Type information comes from the
 * dependencies' built declarations, so a workspace checked against an outdated one would see stale types: it waits for
 * a build.
 */
function withCurrentDependencies(context: GateContext, units: readonly Unit[]): {ready: Unit[]; note?: string} {
  const waiting: string[] = []
  const ready = units.filter(unit => {
    const outdated = outdatedDependencies(context, unit)
    if (outdated.length) waiting.push(`${unit.path} (${outdated.join(', ')} unbuilt, unfinished or out of date)`)
    return !outdated.length
  })
  return waiting.length ? {ready, note: `not checked until ${TOOLS} build <workspace>: ${waiting.join('; ')}`} : {ready}
}

/** `check --fast`'s typecheck: the changed workspaces only, against their dependencies' current dist. */
export function fastTypecheck(context: GateContext): Plan {
  const changed = new Set(context.affected?.changed ?? [])
  const units = inDependencyOrder(context.units, changed)
    .map(path => context.units.find(unit => unit.path === path)!)
    .filter(unit => unit.kinds.includes('npm') && unit.scripts.includes('typecheck'))
  if (!units.length) return {skip: 'no changed workspace has a typecheck script'}
  const {ready, note} = withCurrentDependencies(context, units)
  if (!ready.length) return {skip: note!}
  return {commands: ready.map(unit => npm('run', 'typecheck', '--workspace', unit.names[0]!)), ...(note ? {note} : {})}
}

/** The npm workspace a repository path belongs to: the deepest one holding it. */
const workspaceOf = (context: GateContext, path: string) =>
  context.units
    .filter(unit => unit.kinds.includes('npm') && path.startsWith(`${unit.path}/`))
    .toSorted((left, right) => right.path.length - left.path.length)[0]

/** Files every lint result depends on: the configuration, what it imports, and the compiler options. */
const lintConfiguration =
  /^(?:eslint\.config\.js|eslint-suppressions\.json|tsconfig\.base\.json|package(?:-lock)?\.json|tools\/scripts\/(?:lint|engine-contracts)\.mjs|tools\/scripts\/check-machines\/lifecycle-rule\.mjs)$/u

/**
 * The lint gate, a process per workspace as npm run lint runs it, since one process over many workspaces holds every
 * workspace's TypeScript program. Everything, or a change to the lint configuration: npm run lint. --affected: the
 * changed and dependent workspaces (a changed type can break a dependant's type-aware rules) and the changed files
 * outside every workspace. --fast: only the changed files; TypeScript in a workspace only when its dependencies' dist
 * is current, as for the typecheck. JavaScript has no type-aware rules, so it never waits.
 */
export function lintPlan(context: GateContext): Plan {
  const configuration = (context.files ?? []).some(path => lintConfiguration.test(path))
  if (!context.affected || (configuration && !context.fast)) return {commands: [npm('run', '--silent', 'lint')]}
  const files = changedFiles(context, /\.[cm]?[jt]sx?$/u)
  const eslint = (...paths: string[]) => npx('eslint', '--quiet', '--no-warn-ignored', ...paths)
  const outside = files.filter(path => !workspaceOf(context, path))
  if (!context.fast) {
    const units = inDependencyOrder(context.units, [...context.affected.changed, ...context.affected.dependants])
      .map(path => context.units.find(unit => unit.path === path)!)
      .filter(unit => unit.kinds.includes('npm'))
    const commands = [...units.map(unit => eslint(unit.path)), ...(outside.length ? [eslint(...outside)] : [])]
    return commands.length ? {commands} : {skip: 'no TypeScript or JavaScript changed'}
  }
  if (!files.length) return {skip: 'no TypeScript or JavaScript changed'}
  const byUnit = new Map<Unit, string[]>()
  for (const path of files) {
    const unit = workspaceOf(context, path)
    if (unit) byUnit.set(unit, [...(byUnit.get(unit) ?? []), path])
  }
  const {ready, note: waiting} = withCurrentDependencies(context, [...byUnit.keys()])
  const groups = [
    outside,
    ...[...byUnit].map(([unit, paths]) => (ready.includes(unit) ? paths : paths.filter(path => /\.[cm]?js$/u.test(path)))),
  ].filter(group => group.length)
  const note = [configuration ? `the lint configuration changed: run npm run lint to lint everything` : undefined, waiting]
    .filter(Boolean)
    .join('; ')
  if (!groups.length) return {skip: note}
  return {commands: groups.map(group => eslint(...group)), ...(note ? {note} : {})}
}
