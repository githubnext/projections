// What CI runs for a change (CONTRIBUTING.md#what-ci-runs). This module holds no rule of its own: which files run
// everything, which jobs and suites run for what, and how suites are sharded are all in .github/ci-rules.json. It
// evaluates them in this order:
//
// 1. Each changed file gets one class (ci-files.ts).
// 2. The run is full when its event or a label asks for it, or a file's class is full: then every job, matrix entry
//    and suite runs, whatever its `when` says.
// 3. Otherwise the code files give the touched workspaces and crates, and those with everything depending on them,
//    the reached ones (ci-facts.ts reads the graph).
// 4. Each job's and matrix entry's `when` is evaluated against the paths and the touched and reached units.
// 5. Each browser suite runs when the change reaches it or a workspace its script builds, or its `when` holds; then
//    the suites are laid out in jobs and shards (ci-browser.ts), and the harness narrowed.
import {browserJobs, type BrowserJob, type Layout} from './ci-browser.ts'
import type {RepoFacts} from './ci-facts.ts'
import {classifyFiles, type ClassifiedFile, type Contents} from './ci-files.ts'
import {ruleProblems} from './ci-rules-check.ts'
import {FULL, holds, reach, reasons, resolveGroups, RULES, type CiRules, type Context, type When} from './ci-rules.ts'

export interface Change {
  paths: readonly string[]
  /** The GitHub Actions event; `pull_request` (the default) follows the change. */
  event?: string
  /** The pull request's labels. */
  labels?: readonly string[]
  /** The changed files' contents before and after, for lockfiles; without them, a lockfile change runs everything. */
  contents?: Contents
}

export interface CiPlan {
  /** Why everything runs; empty when the plan follows the change. */
  full: string[]
  files: ClassifiedFile[]
  docsOnly: boolean
  /** Workspaces and crates containing, building in or reading a changed file. */
  changed: string[]
  /** Those depending on one that contains or builds in a changed file, each with the dependency that led there. */
  dependants: Record<string, string>
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

/** One check the plan runs, as GitHub lists it, and what it runs. */
export interface Execution {
  check: string
  job: string
  /** A matrix entry's values. */
  with?: Record<string, string>
  /** Browser suites it runs. */
  suites?: string[]
  project?: string
  shard?: string
  grepInvert?: string
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

function evaluate(rules: CiRules, facts: RepoFacts, files: readonly ClassifiedFile[], docsOnly: boolean): Context {
  const touched = new Set(files.flatMap(file => file.touches))
  const tested = new Set(files.flatMap(file => file.tested))
  // A unit some file builds in counts as built, though another file's tests alone read it.
  for (const file of files) for (const unit of file.touches) if (!file.tested.includes(unit)) tested.delete(unit)
  return {
    rules,
    groups: resolveGroups(rules, facts),
    docsOnly,
    paths: files.map(file => file.path),
    mutants: facts.mutants,
    touched,
    reached: reach(facts.units, touched, tested),
  }
}

function suiteRuns(facts: RepoFacts, rules: CiRules, path: string, context: Context): boolean {
  const suite = facts.browserSuites.find(item => item.path === path)
  const when: When | undefined = rules.browser.suites[path]?.when
  return (
    suite !== undefined &&
    (context.reached.has(path) || suite.uses.some(unit => context.reached.has(unit)) || (when !== undefined && holds(when, context)))
  )
}

/** A suite to narrow: one that runs only because of changes to some (not all) members of its `narrow` group. */
function narrowed(facts: RepoFacts, rules: CiRules, files: readonly ClassifiedFile[], context: Context, affected: readonly string[]) {
  for (const [path, suite] of Object.entries(rules.browser.suites)) {
    if (!suite.narrow || !affected.includes(path)) continue
    const members = context.groups.get(suite.narrow.group) ?? new Set<string>()
    const kept = [...context.touched].filter(unit => members.has(unit)).toSorted()
    if (!kept.length || kept.length === members.size) continue
    const others = files.map(file => ({...file, touches: file.touches.filter(unit => !kept.includes(unit))}))
    const {touched, reached} = evaluate(rules, facts, others, false)
    if (suiteRuns(facts, rules, path, {...context, touched, reached})) continue
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
  const files = classifyFiles(facts, rules, paths, contents)
  const full = [
    ...(rules.full.events.includes(event) ? [`a ${event} run`] : []),
    ...labels.filter(label => rules.full.labels.includes(label)).map(label => `the ${label} label`),
    ...Object.entries(
      Object.groupBy(
        files.filter(file => file.class === 'full'),
        file => file.rule,
      ),
    ).map(([rule, matched]) => `${rule} (${(matched ?? []).map(file => file.path).join(', ')})`),
  ]
  const all = full.length > 0
  const docsOnly = !all && files.every(file => file.class === 'docs')
  const state = evaluate(rules, facts, files, docsOnly)
  const decide = (when: When) => all || holds(when, state)
  const jobs: CiPlan['jobs'] = {}
  const why: CiPlan['why'] = {}
  const matrices: CiPlan['matrices'] = {}
  for (const [name, job] of Object.entries(rules.jobs)) {
    if ('when' in job) {
      jobs[name] = (!job.events || job.events.includes(event)) && decide(job.when)
      // A predicate on files or units gives no reason of its own: the job's description says what it checks.
      if (jobs[name]) why[name] = all ? [FULL] : reasons(job.when, state).length ? reasons(job.when, state) : [job.description]
    } else {
      const entries = job.matrix.filter(item => decide(item.when))
      jobs[name] = entries.map(item => item.name)
      matrices[name] = entries.map(item => ({name: item.name, ...item.with}))
      if (entries.length) why[name] = all ? [FULL] : entries.map(item => `${item.name}: ${item.description}`)
    }
  }
  const suites = facts.browserSuites.map(suite => suite.path).filter(path => all || suiteRuns(facts, rules, path, state))
  const narrow = all ? undefined : narrowed(facts, rules, files, state, suites)
  const browser = browserJobs(
    facts.browserSuites.map(suite => suite.path),
    new Set(suites),
    layouts(rules),
    narrow,
  )
  const changed = [...state.touched].toSorted()
  return {
    full,
    files,
    docsOnly,
    changed,
    dependants: Object.fromEntries(
      [...state.reached].filter(([unit]) => !state.touched.has(unit)).toSorted(([a], [b]) => a.localeCompare(b)),
    ),
    conditions: Object.fromEntries(Object.entries(rules.conditions).map(([name, {when}]) => [name, decide(when)])),
    jobs,
    matrices,
    why,
    suites,
    renderers: narrow?.kept ?? [],
    browser: browser.linux,
    browserMacos: browser.macos,
  }
}

/** Every check the plan runs, with the suites, projects, shards and filters of each: what replays and explanations compare. */
export function executions(plan: CiPlan, rules: CiRules): Execution[] {
  const sharded = new Set(Object.entries(rules.browser.suites).flatMap(([path, suite]) => (suite.shards === undefined ? [] : [path])))
  const rest = plan.suites.filter(suite => !sharded.has(suite))
  const browser = (job: string, item: BrowserJob): Execution => ({
    check: `${job} (${item.name})`,
    job,
    suites: item.suite === 'rest' ? rest : [item.suite],
    ...(item.project ? {project: item.project} : {}),
    ...(item.shard ? {shard: item.shard} : {}),
    ...(item.grepInvert ? {grepInvert: item.grepInvert} : {}),
  })
  return [
    ...Object.entries(plan.jobs).flatMap(([job, value]): Execution[] =>
      Array.isArray(value)
        ? (plan.matrices[job] ?? []).map(({name, ...values}) => ({check: `${job} (${name})`, job, with: values}))
        : !value
          ? []
          : shardsOf(rules, job).map(shard => (shard === undefined ? {check: job, job} : {check: `${job} (${shard})`, job, shard})),
    ),
    ...plan.browser.map(item => browser('browser', item)),
    ...plan.browserMacos.map(item => browser('browser-macos', item)),
  ]
}

/** A job's workflow shards (`0` to `N-1`), or one unsharded check. */
function shardsOf(rules: CiRules, job: string): (string | undefined)[] {
  const definition = rules.jobs[job]
  const count = definition && 'shards' in definition ? definition.shards : undefined
  return count !== undefined && count !== 0 ? Array.from({length: count}, (_, index) => String(index)) : [undefined]
}

/** The `changes` job's step outputs: each job's decision by ID (a matrix job's as its `matrix.include`), and the rest. */
export function planOutputs(plan: CiPlan): Record<string, string> {
  const jobs = Object.entries(plan.jobs).map(
    ([name, value]) => [name, Array.isArray(value) ? JSON.stringify(plan.matrices[name]) : String(value)] as const,
  )
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
