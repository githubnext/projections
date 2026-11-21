// Reads .github/ci-rules.json and evaluates its `when` predicates against a change. The file's shape is
// ci-rules.schema.ts's; this module imports only its types, so CI's `changes` job runs it without an install, and the
// tools package's tests validate the file against the schema.
import type {CiRules, When} from './ci-rules.schema.ts'
import type {RepoFacts} from './ci-facts.ts'
import {dependantsOf} from './packages.ts'
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

/** What a predicate is evaluated against. */
export type Context = {
  rules: CiRules
  facts: RepoFacts
  groups: Map<string, Set<string>>
  /** Why everything runs; empty when the plan follows the change. */
  full: string[]
  docsOnly: boolean
  paths: readonly string[]
  tags: Set<string>
  generators: Set<string>
  /** Workspaces and crates containing, building in or reading a changed file. */
  built: string[]
  /** Those, and the crates whose tests alone read a changed file. */
  changed: string[]
  /** The browser suite being decided, for `reachesSuite`. */
  suite?: {path: string; uses: string[]}
}

function group(context: Context, name: string): Set<string> {
  const members = context.groups.get(name)
  if (!members) throw new Error(`${RULES}: no group ${name}`)
  return members
}

/** The built units in `from` (all, without it), and everything depending on them. */
function reached(context: Context, from: string | undefined): Set<string> {
  const keep = from ? group(context, from) : undefined
  const built = keep ? context.built.filter(path => keep.has(path)) : context.built
  return new Set([...built, ...dependantsOf(context.facts.units, built)])
}

export function holds(when: When, context: Context): boolean {
  if (when === 'always') return true
  if (when === 'full') return context.full.length > 0
  if (when === 'docsOnly') return context.docsOnly
  if (when === 'reachesSuite') {
    if (!context.suite) throw new Error(`${RULES}: reachesSuite outside a browser suite`)
    const reach = reached(context, undefined)
    return reach.has(context.suite.path) || context.suite.uses.some(path => reach.has(path))
  }
  if ('any' in when) return when.any.some(item => holds(item, context))
  if ('all' in when) return when.all.every(item => holds(item, context))
  if ('not' in when) return !holds(when.not, context)
  if ('if' in when) {
    const condition = context.rules.conditions[when.if]
    if (!condition) throw new Error(`${RULES}: no condition ${when.if}`)
    return holds(condition.when, context)
  }
  if ('changes' in when) {
    if (Array.isArray(when.changes)) return context.paths.some(path => matches(path, when.changes as string[]))
    const {examine, exclude} = context.facts.mutants
    return context.paths.some(path => matches(path, examine) && !matches(path, exclude))
  }
  if ('tag' in when) return context.tags.has(when.tag)
  if ('generator' in when) return context.generators.has(when.generator)
  if ('changed' in when) {
    const members = group(context, when.changed)
    return context.changed.some(path => members.has(path))
  }
  const members = group(context, when.reaches)
  return [...reached(context, when.from)].some(path => members.has(path))
}

/** The reason a job gives when everything runs; the plan's `full` says why it does. */
export const FULL = 'Everything runs'

/** Why a predicate holds: the descriptions of the conditions and tags on the way. */
export function reasons(when: When, context: Context): string[] {
  if (!holds(when, context)) return []
  if (when === 'full') return [FULL]
  if (typeof when === 'string') return []
  if ('any' in when) return [...new Set(when.any.flatMap(item => reasons(item, context)))]
  if ('all' in when) return [...new Set(when.all.flatMap(item => reasons(item, context)))]
  if ('if' in when) {
    const inner = reasons(context.rules.conditions[when.if]?.when as When, context)
    return inner.includes(FULL) ? [FULL] : [context.rules.conditions[when.if]?.description as string]
  }
  if ('tag' in when) return [context.rules.tags[when.tag]?.description as string]
  return []
}
