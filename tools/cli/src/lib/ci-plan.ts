// What CI runs for a change (CONTRIBUTING.md#what-ci-runs): the rules of .github/ci-rules.json applied to the changed
// files' workspaces and crates and everything depending on them (ci-facts.ts reads the graph). This module holds no
// rule of its own: which files run everything, which jobs and suites run for what, and how suites are sharded are
// all in the rules file.
import {browserJobs, type BrowserJob, type Layout} from './ci-browser.ts'
import type {RepoFacts} from './ci-facts.ts'
import {sortChanges, type Contents} from './ci-files.ts'
import {ruleProblems} from './ci-rules-check.ts'
import {holds, reasons, resolveGroups, RULES, type CiRules, type Context} from './ci-rules.ts'
import {dependantsOf} from './packages.ts'

export type Change = {
  paths: readonly string[]
  /** The GitHub Actions event; `pull_request` (the default) follows the change. */
  event?: string
  /** The pull request's labels. */
  labels?: readonly string[]
  /** The changed files' contents before and after, for the lockfile rules; without them, a lockfile change runs everything. */
  contents?: Contents
}

export type CiPlan = {
  /** Why everything runs; empty when the plan follows the change. */
  full: string[]
  files: number
  docsOnly: boolean
  /** Changed workspaces and crates, and those depending on them. */
  changed: string[]
  dependants: string[]
  generators: string[]
  /** Each condition of the rules file, and whether it holds. */
  conditions: Record<string, boolean>
  /** Each job the rules gate: whether it runs, or the names of a matrix job's entries. */
  jobs: Record<string, boolean | string[]>
  /** A matrix job's entries, as the workflow's `matrix.include`. */
  matrices: Record<string, Record<string, string>[]>
  /** Why each job that runs does: the descriptions of the rules that hold. */
  why: Record<string, string[]>
  /** The affected browser suites. */
  suites: string[]
  /** The renderers the harness is limited to; empty when it runs all or none. */
  renderers: string[]
  browser: BrowserJob[]
  browserMacos: BrowserJob[]
}

function layouts(rules: CiRules): {linux: Layout; macos: Layout} {
  const linux: Layout = {}
  const macos: Layout = {}
  for (const [suite, {shards, macos: projects}] of Object.entries(rules.browser.suites)) {
    if (shards !== undefined) linux[suite] = typeof shards === 'number' ? {'': shards} : shards
    if (projects) macos[suite] = projects
  }
  return {linux, macos}
}

function affectedSuites(context: Context): string[] {
  return context.facts.browserSuites
    .filter(suite => holds(context.rules.browser.suites[suite.path]?.when ?? context.rules.browser.default.when, {...context, suite}))
    .map(suite => suite.path)
}

/** A suite to narrow: one that runs only because of changes to some (not all) members of its `narrow` group. */
function narrowed(context: Context, affected: readonly string[]): {suite: string; kept: string[]; others: string[]} | undefined {
  for (const [path, suite] of Object.entries(context.rules.browser.suites)) {
    if (!suite.narrow || !affected.includes(path)) continue
    const members = context.groups.get(suite.narrow.group) ?? new Set<string>()
    const kept = context.built.filter(unit => members.has(unit))
    if (!kept.length || kept.length === members.size) continue
    const rest = context.built.filter(unit => !kept.includes(unit))
    const facts = context.facts.browserSuites.find(item => item.path === path)
    const others: Context = {...context, built: rest, changed: rest}
    if (facts) others.suite = facts
    if (holds(suite.when ?? context.rules.browser.default.when, others)) continue
    const name = (unit: string) => unit.slice(unit.lastIndexOf('/') + 1)
    return {suite: path, kept: kept.map(name), others: [...members].filter(unit => !kept.includes(unit)).map(name)}
  }
  return undefined
}

export function ciPlan(facts: RepoFacts, rules: CiRules, change: Change): CiPlan {
  const {paths, event = 'pull_request', labels = [], contents} = change
  const problems = ruleProblems(
    rules,
    facts.browserSuites.map(suite => suite.path),
  )
  if (problems.length) throw new Error(`${RULES}:\n${problems.join('\n')}`)
  const sorted = sortChanges(facts, rules, paths, contents)
  const full = [
    ...(rules.full.events.includes(event) ? [`a ${event} run`] : []),
    ...labels.filter(label => rules.full.labels.includes(label)).map(label => `the ${label} label`),
    ...Object.entries(Object.groupBy(sorted.everything, ({rule}) => rule)).map(
      ([rule, files]) => `${rule} (${(files ?? []).map(({path}) => path).join(', ')})`,
    ),
  ]
  const built = [...sorted.units].sort()
  const changed = [...new Set([...built, ...sorted.tested])].sort()
  const context: Context = {
    rules,
    facts,
    groups: resolveGroups(rules, facts),
    full,
    docsOnly: !full.length && sorted.docsOnly,
    paths,
    tags: sorted.tags,
    generators: sorted.generators,
    built,
    changed,
  }
  const jobs: CiPlan['jobs'] = {}
  const why: CiPlan['why'] = {}
  const matrices: CiPlan['matrices'] = {}
  for (const [name, job] of Object.entries(rules.jobs)) {
    if ('when' in job) {
      jobs[name] = holds(job.when, context)
      // A predicate on files or units gives no reason of its own: the job's description says what it checks.
      if (jobs[name]) why[name] = reasons(job.when, context).length ? reasons(job.when, context) : [job.description]
    } else {
      const entries = job.matrix.filter(item => holds(item.when, context))
      jobs[name] = entries.map(item => item.name)
      matrices[name] = entries.map(item => ({name: item.name, ...item.with}))
      if (entries.length) why[name] = entries.map(item => `${item.name}: ${item.description}`)
    }
  }
  const suites = affectedSuites(context)
  const narrow = narrowed(context, suites)
  const browser = browserJobs(
    facts.browserSuites.map(suite => suite.path),
    new Set(suites),
    layouts(rules),
    narrow,
  )
  return {
    full,
    files: paths.length,
    docsOnly: context.docsOnly,
    changed,
    dependants: dependantsOf(facts.units, built).filter(path => !changed.includes(path)),
    generators: [...sorted.generators].sort(),
    conditions: Object.fromEntries(Object.entries(rules.conditions).map(([name, {when}]) => [name, holds(when, context)])),
    jobs,
    matrices,
    why,
    suites,
    renderers: narrow?.kept ?? [],
    browser: browser.linux,
    browserMacos: browser.macos,
  }
}

/** The `changes` job's step outputs: each job's decision by ID (a matrix job's as its `matrix.include`), and the rest. */
export function planOutputs(plan: CiPlan): Record<string, string> {
  const jobs = Object.entries(plan.jobs).map(([name, value]) => [
    name,
    Array.isArray(value) ? JSON.stringify(plan.matrices[name]) : String(value),
  ])
  return {
    full: String(plan.full.length > 0),
    'docs-only': String(plan.docsOnly),
    ...Object.fromEntries(Object.entries(plan.conditions).map(([name, value]) => [`if-${name}`, String(value)])),
    ...Object.fromEntries(jobs),
    suites: JSON.stringify(plan.suites),
    renderers: plan.renderers.join(','),
    browser: JSON.stringify(plan.browser),
    'browser-macos': JSON.stringify(plan.browserMacos),
  }
}
