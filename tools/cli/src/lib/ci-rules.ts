// Reads .github/ci-rules.json and evaluates its `when` predicates against a change. The file's shape is
// ci-rules.schema.ts's; this module imports only its types, so CI's `changes` job runs it without an install, and the
// tools package's tests validate the file against the schema.
import type {CiRules, When} from './ci-rules.schema.ts'
import type {RepoFacts} from './ci-facts.ts'
import type {Unit} from './packages.ts'
import {matches, readJson} from './repo.ts'

export type {CiRules, When}

export const RULES = '.github/ci-rules.json'

export function loadCiRules(root: string): CiRules {
  const rules = readJson<CiRules>(root, RULES)
  if (!rules?.files?.length || !rules.jobs || !rules.browser?.suites)
    throw new Error(`${RULES} is missing or has no files, jobs or browser`)
  return rules
}

/** The workspaces and crates in each group. */
export function resolveGroups(rules: CiRules, facts: RepoFacts): Map<string, Set<string>> {
  const units = facts.units.map(unit => unit.path)
  const resolved = new Map<string, Set<string>>()
  const resolve = (name: string, stack: string[]): Set<string> => {
    const done = resolved.get(name)
    if (done) return done
    const group = rules.groups[name]
    if (!group) throw new Error(`${RULES}: no group ${name}`)
    if (stack.includes(name)) throw new Error(`${RULES}: group ${[...stack, name].join(' → ')} refers to itself`)
    type Selector = (typeof group.include)[number]
    const select = (selector: Selector): string[] => {
      if (typeof selector === 'string')
        return selector.startsWith('@')
          ? [...resolve(selector.slice(1), [...stack, name])]
          : units.filter(path => matches(path, [selector]))
      if ('kind' in selector) return facts.units.filter(unit => unit.kinds.includes(selector.kind)).map(unit => unit.path)
      if (selector.facts === 'coverage') return facts.coverage
      return facts.harnessRenderers.map(renderer => `packages/renderers/${renderer}`)
    }
    const excluded = new Set((group.exclude ?? []).flatMap(select))
    const members = new Set(group.include.flatMap(select).filter(path => !excluded.has(path)))
    resolved.set(name, members)
    return members
  }
  for (const name of Object.keys(rules.groups)) resolve(name, [])
  return resolved
}

/**
 * The workspaces and crates a change reaches, each with its witness: the unit it depends on that led there (itself,
 * for those the change touches). Dependants are followed only from units that contain or build in a changed file, not
 * from crates whose tests alone read one.
 */
export function reach(units: readonly Unit[], touched: Iterable<string>, tested: ReadonlySet<string>): Map<string, string> {
  const reverse = new Map<string, string[]>()
  for (const unit of units)
    for (const dependency of unit.dependsOn) reverse.set(dependency, [...(reverse.get(dependency) ?? []), unit.path])
  const witness = new Map<string, string>()
  for (const unit of touched) witness.set(unit, unit)
  const queue = [...witness.keys()].filter(unit => !tested.has(unit)).sort()
  const expanded = new Set(queue)
  while (queue.length) {
    const unit = queue.shift() as string
    for (const dependant of (reverse.get(unit) ?? []).sort()) {
      if (!witness.has(dependant)) witness.set(dependant, unit)
      if (expanded.has(dependant)) continue
      expanded.add(dependant)
      queue.push(dependant)
    }
  }
  return witness
}

/** What a predicate is evaluated against: a pull request that follows its change. */
export type Context = {
  rules: CiRules
  groups: Map<string, Set<string>>
  docsOnly: boolean
  paths: readonly string[]
  mutants: RepoFacts['mutants']
  /** Workspaces and crates containing, building in or reading a changed file. */
  touched: ReadonlySet<string>
  /** Those, and everything depending on one that contains or builds in a changed file: each with its witness. */
  reached: ReadonlyMap<string, string>
}

function group(context: Context, name: string): Set<string> {
  const members = context.groups.get(name)
  if (!members) throw new Error(`${RULES}: no group ${name}`)
  return members
}

export function holds(when: When, context: Context): boolean {
  if (when === 'always') return true
  if (when === 'never') return false
  if (when === 'docsOnly') return context.docsOnly
  if ('any' in when) return when.any.some(item => holds(item, context))
  if ('not' in when) return !holds(when.not, context)
  if ('if' in when) {
    const condition = context.rules.conditions[when.if]
    if (!condition) throw new Error(`${RULES}: no condition ${when.if}`)
    return holds(condition.when, context)
  }
  if ('changes' in when) {
    if (Array.isArray(when.changes)) return context.paths.some(path => matches(path, when.changes as string[]))
    const {examine, exclude} = context.mutants
    return context.paths.some(path => matches(path, examine) && !matches(path, exclude))
  }
  if ('touches' in when) return [...group(context, when.touches)].some(unit => context.touched.has(unit))
  return [...group(context, when.reaches)].some(unit => context.reached.has(unit))
}

/** The reason a job gives when everything runs; the plan's `full` says why it does. */
export const FULL = 'Everything runs'

/** Why a predicate holds: the descriptions of the named conditions on the way. */
export function reasons(when: When, context: Context): string[] {
  if (typeof when === 'string' || !holds(when, context)) return []
  if ('any' in when) return [...new Set(when.any.flatMap(item => reasons(item, context)))]
  if ('if' in when) return [context.rules.conditions[when.if]?.description as string]
  return []
}
