// Replays CI plans under two versions of the rules and planner: those at a base ref (usually origin/main) and the
// working tree's. For a change to .github/ci-rules.json or the planner, it shows what would run differently for the
// last merged pull requests and for every tracked file alone, at the level of checks (suites, projects, shards and
// filters included) and in runner-minutes. `tools ci replay` runs it locally; it isn't a CI step.
import {spawnSync} from 'node:child_process'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import type {Change, CiPlan, Execution} from './ci-plan.ts'
import type {CiRules} from './ci-rules.ts'
import {git} from './repo.ts'

/**
 * Runner-minutes per check: medians of the last 8 full runs on main and of pull request runs (narrowed harness jobs,
 * docs), and `browser (rest)` as its setup and build plus each suite it runs. Measured 2026-11-21; refresh them from a
 * recent run's job times when they drift. A check not listed costs nothing, and is named in the report.
 */
export const PRICES = {
  checks: {
    docs: 0.6,
    'public-product (ubuntu-latest)': 36.8,
    'public-product (macos-latest, Rust)': 29.5,
    'public-product (macos-latest, Node)': 22.6,
    verus: 2,
    windows: 33.8,
    'windows-node': 24.8,
    'windows-integration': 32.8,
    package: 12.7,
    'release-config': 0.4,
    coverage: 1.3,
    'actions-lock': 0.2,
  } as Record<string, number>,
  /** A shard of a job the workflow shards (the rules' `shards`), by job. */
  shards: {'mutants-diff': 2.1} as Record<string, number>,
  /** A browser job by suite, or by Playwright project for the renderer harness. */
  browser: {
    'packages/host/core': 21.9,
    'tools/storybook': 16.7,
    'packages/host/inspector': 18,
    'chromium-desktop': 18.1,
    'webkit-desktop': 18.8,
    'chromium-mobile': 20.2,
    'webkit-mobile': 19.6,
  } as Record<string, number>,
  /** A harness job narrowed to some renderers, by project. */
  narrowed: {'chromium-desktop': 15.7, 'webkit-desktop': 16.4, 'chromium-mobile': 15.1, 'webkit-mobile': 19} as Record<string, number>,
  macos: {full: 27.1, narrowed: 18.6},
  rest: {
    setup: 12.4,
    suites: {
      'packages/host/vscode-ui': 8.2,
      'packages/cli': 3.2,
      'packages/engine/js': 0.7,
      'examples/renderers/minimal': 0.25,
      'packages/comparators/runtime/js': 0.05,
    } as Record<string, number>,
  },
}

export interface Priced {
  runners: number
  minutes: number
  macos: number
  checks: string[]
  unpriced: string[]
}

/** JSON with object keys sorted, so two executions that differ only in key order compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).toSorted(([a], [b]) => a.localeCompare(b)))
      : item,
  )
}

export function price(checks: readonly Execution[]): Priced {
  const priced: Priced = {runners: 0, minutes: 0, macos: 0, checks: checks.map(canonical).toSorted(), unpriced: []}
  for (const check of checks) {
    let minutes: number | undefined
    if (check.job in PRICES.shards) minutes = PRICES.shards[check.job]
    else if (check.job === 'browser-macos') minutes = check.grepInvert ? PRICES.macos.narrowed : PRICES.macos.full
    else if (check.check === 'browser (rest)') {
      const suites = check.suites ?? []
      for (const suite of suites) if (!(suite in PRICES.rest.suites)) priced.unpriced.push(`browser (rest): ${suite}`)
      minutes = PRICES.rest.setup + suites.reduce((sum, suite) => sum + (PRICES.rest.suites[suite] ?? 0), 0)
    } else if (check.job === 'browser') {
      minutes = check.project
        ? (check.grepInvert ? PRICES.narrowed : PRICES.browser)[check.project]
        : PRICES.browser[check.suites?.[0] ?? '']
    } else minutes = PRICES.checks[check.check]
    if (minutes === undefined) priced.unpriced.push(check.check)
    priced.runners += 1
    priced.minutes += minutes ?? 0
    if (check.job === 'browser-macos' || check.with?.os?.startsWith('macos')) priced.macos += minutes ?? 0
  }
  return priced
}

/** A planner: the rules and plan functions of one version of tools/cli/src/lib. */
export interface Planner {
  rules: CiRules
  plan: (change: Change) => CiPlan
  checks: (plan: CiPlan) => Execution[]
}

interface PlannerModules {
  facts: {repoFacts: (root: string) => unknown}
  plan: {ciPlan: (facts: unknown, rules: CiRules, change: Change) => CiPlan; executions?: (plan: CiPlan, rules: CiRules) => Execution[]}
  rules: {loadCiRules: (root: string) => CiRules}
}

/** The planner in `lib` (a tools/cli/src/lib directory), with the rules under `rulesRoot`, on this checkout's graph. */
export async function loadPlanner(
  root: string,
  lib: string,
  rulesRoot: string,
  fallback?: (plan: CiPlan, rules: CiRules) => Execution[],
): Promise<Planner> {
  const load = async <T>(name: string) => (await import(pathToFileURL(join(lib, name)).href)) as T
  const facts = await load<PlannerModules['facts']>('ci-facts.ts')
  const plan = await load<PlannerModules['plan']>('ci-plan.ts')
  const rules = (await load<PlannerModules['rules']>('ci-rules.ts')).loadCiRules(rulesRoot)
  const repo = facts.repoFacts(root)
  const executions = plan.executions
  const checks = executions ?? fallback
  if (!checks) throw new Error(`${lib} has no execution plan`)
  return {rules, plan: change => plan.ciPlan(repo, rules, change), checks: item => checks(item, rules)}
}

/** A copy of the planner and rules at `ref`, in a temporary directory, and how to remove it. */
export function checkoutPlanner(root: string, ref: string): {directory: string; remove: () => void} {
  const directory = mkdtempSync(join(tmpdir(), 'ci-replay-'))
  const archive = spawnSync('git', ['archive', ref, 'tools/cli/src/lib', '.github/ci-rules.json'], {cwd: root, maxBuffer: 1 << 28})
  if (archive.status !== 0) throw new Error(`git archive ${ref} failed: ${archive.stderr}`)
  const tar = spawnSync('tar', ['-x', '-C', directory], {input: archive.stdout})
  if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr}`)
  return {directory, remove: () => rmSync(directory, {recursive: true, force: true})}
}

export interface Commit {
  sha: string
  subject: string
  paths: string[]
}

/** The last `count` commits on `ref`'s first-parent history (squash-merged pull requests), with their changed files. */
export function mergedCommits(root: string, ref: string, count: number): Commit[] {
  const log = git(root, ['log', '--first-parent', `-n${count}`, '--format=%H%x09%s', ref]) ?? ''
  return log
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [sha = '', subject = ''] = line.split('\t')
      const diff = git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', '--no-renames', `${sha}^`, sha])
      // A shallow clone's last commit has no parent to compare with: replaying it as an empty change would be wrong.
      if (diff === undefined) {
        throw new Error(`Can't diff ${sha.slice(0, 12)} with its parent; fetch more history (git fetch --deepen ${count})`)
      }
      return {sha, subject, paths: diff.split('\n').filter(Boolean)}
    })
}

export interface Difference {
  name: string
  added: string[]
  removed: string[]
  changedChecks: string[]
  minutes: number
}

export interface Side {
  runners: number
  minutes: number
  macos: number
}

/** Files whose plans differ in the same way. */
export interface Kind {
  count: number
  added: string[]
  removed: string[]
  changed: string[]
  examples: string[]
}

export interface Replay {
  commits: {before: Side; after: Side; selective: {before: Side; after: Side}; full: number; differences: Difference[]}
  files?: {count: number; changed: number; minutes: number; kinds: Kind[]}
  unpriced: string[]
}

/** A difference with its minutes rounded for the report, after any sums. */
const round = (item: Difference): Difference => ({...item, minutes: Math.round(item.minutes * 10) / 10})

const side = (items: readonly Priced[]): Side => ({
  runners: items.reduce((sum, item) => sum + item.runners, 0),
  minutes: Math.round(items.reduce((sum, item) => sum + item.minutes, 0)),
  macos: Math.round(items.reduce((sum, item) => sum + item.macos, 0)),
})

/** What differs between two priced plans: checks added and removed, and checks kept whose suites, shards or filters changed. */
function difference(name: string, before: Priced, after: Priced): Difference | undefined {
  const names = (priced: Priced) => priced.checks.map(check => (JSON.parse(check) as Execution).check)
  const [a, b] = [names(before), names(after)]
  if (before.checks.join('\n') === after.checks.join('\n')) return undefined
  const changedChecks = b.filter(check => a.includes(check) && !after.checks.includes(before.checks[a.indexOf(check)]!))
  return {
    name,
    added: b.filter(check => !a.includes(check)),
    removed: a.filter(check => !b.includes(check)),
    changedChecks,
    minutes: after.minutes - before.minutes,
  }
}

export function replay(
  before: Planner,
  after: Planner,
  commits: readonly Commit[],
  files: readonly string[] | undefined,
  root: string,
): Replay {
  const unpriced = new Set<string>()
  const run = (planner: Planner, change: Change) => {
    const priced = price(planner.checks(planner.plan(change)))
    for (const check of priced.unpriced) unpriced.add(check)
    return priced
  }
  const rows = commits.map(commit => {
    const contents = {
      before: (path: string) => git(root, ['show', `${commit.sha}^:${path}`]),
      after: (path: string) => git(root, ['show', `${commit.sha}:${path}`]),
    }
    const change = {paths: commit.paths, contents}
    const plan = before.plan(change)
    return {commit, full: plan.full.length > 0, before: run(before, change), after: run(after, change)}
  })
  const selective = rows.filter(row => !row.full)
  const result: Replay = {
    commits: {
      before: side(rows.map(row => row.before)),
      after: side(rows.map(row => row.after)),
      selective: {before: side(selective.map(row => row.before)), after: side(selective.map(row => row.after))},
      full: rows.length - selective.length,
      differences: rows.flatMap(row => difference(row.commit.subject, row.before, row.after) ?? []).map(round),
    },
    unpriced: [],
  }
  if (files) {
    const kinds = new Map<string, Kind>()
    let minutes = 0
    let changed = 0
    for (const path of files) {
      const found = difference(path, run(before, {paths: [path]}), run(after, {paths: [path]}))
      if (!found) continue
      changed++
      minutes += found.minutes
      const key = JSON.stringify([found.added, found.removed, found.changedChecks])
      const kind = kinds.get(key) ?? {count: 0, added: found.added, removed: found.removed, changed: found.changedChecks, examples: []}
      kind.count++
      if (kind.examples.length < 3) kind.examples.push(path)
      kinds.set(key, kind)
    }
    result.files = {
      count: files.length,
      changed,
      minutes: Math.round(minutes),
      kinds: [...kinds.values()].toSorted((a, b) => b.count - a.count).slice(0, 20),
    }
  }
  result.unpriced = [...unpriced].toSorted()
  return result
}
