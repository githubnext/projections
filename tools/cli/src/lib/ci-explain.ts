// Why a CI plan (ci-plan.ts) runs or skips each job and suite: each file's class and rule, the dependency chain that
// reached each workspace and crate, and each `when` traced to the predicates that held or didn't. `tools ci explain`
// prints it; it reads the same plan and execution list CI's `changes` job does.
import type {RepoFacts} from './ci-facts.ts'
import {executions, type CiPlan, type Execution} from './ci-plan.ts'
import {holds, resolveGroups, type CiRules, type Context, type When} from './ci-rules.ts'
import {matches} from './repo.ts'

export interface Trace {
  holds: boolean
  text: string
  children: Trace[]
}

export interface Explanation {
  full: string[]
  files: {path: string; class: string; rule: string}[]
  touched: string[]
  /** Each reached workspace or crate that isn't touched, with the chain of dependencies back to a touched one. */
  reached: {unit: string; through: string[]}[]
  /** Each job and matrix entry, run or skipped, with the trace of its `when`. */
  jobs: {check: string; runs: boolean; why: string[]}[]
  /** Each browser suite, run or skipped, and why. */
  suites: {suite: string; runs: boolean; why: string[]}[]
  checks: Execution[]
}

const few = (items: readonly string[], limit = 4) =>
  items.length > limit ? `${items.slice(0, limit).join(', ')} and ${items.length - limit} more` : items.join(', ')

/** The chain from a reached unit back to the touched one it depends on: [unit, via, …, touched]. */
function chain(plan: CiPlan, unit: string): string[] {
  const path = [unit]
  for (let via = plan.dependants[unit]; via !== undefined; via = plan.dependants[via]) path.push(via)
  return path
}

export function planContext(plan: CiPlan, rules: CiRules, facts: RepoFacts): Context {
  return {
    rules,
    groups: resolveGroups(rules, facts),
    docsOnly: plan.docsOnly,
    paths: plan.files.map(file => file.path),
    mutants: facts.mutants,
    touched: new Set(plan.changed),
    reached: new Map([...plan.changed.map(unit => [unit, unit] as const), ...Object.entries(plan.dependants)]),
  }
}

export function trace(when: When, context: Context, plan: CiPlan): Trace {
  const leaf = (text: string): Trace => ({holds: holds(when, context), text, children: []})
  if (when === 'always') return leaf('always')
  if (when === 'never') return leaf('never: full runs only')
  if (when === 'docsOnly') return leaf('every changed file is documentation')
  if ('any' in when) return {holds: holds(when, context), text: 'any of', children: when.any.map(item => trace(item, context, plan))}
  if ('not' in when) return {holds: holds(when, context), text: 'not', children: [trace(when.not, context, plan)]}
  if ('if' in when) {
    const condition = context.rules.conditions[when.if]
    return {
      holds: holds(when, context),
      text: `${when.if}: ${condition?.description}`,
      children: condition ? [trace(condition.when, context, plan)] : [],
    }
  }
  if ('changes' in when) {
    const globs = Array.isArray(when.changes) ? when.changes : undefined
    const hits = context.paths.filter(path =>
      globs ? matches(path, globs) : matches(path, context.mutants.examine) && !matches(path, context.mutants.exclude),
    )
    const what = globs ? `changes ${few(globs, 6)}` : 'changes a file .cargo/mutants.toml examines'
    return leaf(hits.length ? `${what}: ${few(hits)}` : what)
  }
  const name = 'touches' in when ? when.touches : when.reaches
  const members = [...(context.groups.get(name) ?? [])]
  if ('touches' in when) {
    const hits = members.filter(unit => context.touched.has(unit))
    return leaf(hits.length ? `touches ${name}: ${few(hits)}` : `touches ${name}`)
  }
  const hits = members.filter(unit => context.reached.has(unit))
  const shown = hits.map(unit => (context.touched.has(unit) ? unit : `${unit} (through ${chain(plan, unit).slice(1).join(' ← ')})`))
  return leaf(hits.length ? `reaches ${name}: ${few(shown, 2)}` : `reaches ${name}`)
}

/** A trace as indented lines, each marked ✓ (holds) or ✗. */
export function traceLines(item: Trace, depth = 0): string[] {
  return [`${'  '.repeat(depth)}${item.holds ? '✓' : '✗'} ${item.text}`, ...item.children.flatMap(child => traceLines(child, depth + 1))]
}

export function explain(plan: CiPlan, rules: CiRules, facts: RepoFacts): Explanation {
  const context = planContext(plan, rules, facts)
  const full = plan.full.length ? [`Everything runs: ${plan.full.join('; ')}`] : undefined
  const jobs = Object.entries(rules.jobs).flatMap(([job, definition]) =>
    'when' in definition
      ? [{check: job, runs: plan.jobs[job] === true, why: full ?? traceLines(trace(definition.when, context, plan))}]
      : definition.matrix.map(entry => ({
          check: `${job} (${entry.name})`,
          runs: (plan.jobs[job] as string[]).includes(entry.name),
          why: full ?? traceLines(trace(entry.when, context, plan)),
        })),
  )
  const suites = facts.browserSuites.map(({path, uses}) => {
    const runs = plan.suites.includes(path)
    if (full) return {suite: path, runs, why: full}
    const why: string[] = []
    const reachedBy = [path, ...uses].filter(unit => context.reached.has(unit))
    for (const unit of reachedBy) {
      why.push(
        `✓ the change reaches ${unit === path ? 'it' : `${unit}, which it builds or tests`}${context.touched.has(unit) ? '' : ` (through ${chain(plan, unit).slice(1).join(' ← ')})`}`,
      )
    }
    if (!reachedBy.length) why.push('✗ the change reaches neither it nor a workspace it builds or tests')
    const when = rules.browser.suites[path]?.when
    if (when) why.push(...traceLines(trace(when, context, plan)))
    if (runs && rules.browser.suites[path]?.narrow && plan.renderers.length) {
      why.push(`narrowed to ${plan.renderers.join(', ')}: the other renderers' tests are left out with --grep-invert`)
    }
    return {suite: path, runs, why}
  })
  return {
    full: plan.full,
    files: plan.files.map(({path, class: fileClass, rule}) => ({path, class: fileClass, rule})),
    touched: plan.changed,
    reached: Object.keys(plan.dependants).map(unit => ({unit, through: chain(plan, unit).slice(1)})),
    jobs,
    suites,
    checks: executions(plan, rules),
  }
}
