// `ci explain`: what CI runs for a change and why, from the plan CI's `changes` job makes (CONTRIBUTING.md#what-ci-runs);
// `ci replay`: how a change to the rules or planner changes the plans of recent pull requests and of each file.
import {join, posix} from 'node:path'
import {repoFacts} from '../../lib/ci-facts.ts'
import {changeSince, contentsSince} from '../../lib/ci-change.ts'
import {explain} from '../../lib/ci-explain.ts'
import {ciPlan, executions} from '../../lib/ci-plan.ts'
import {checkoutPlanner, loadPlanner, mergedCommits, replay} from '../../lib/ci-replay.ts'
import {loadCiRules} from '../../lib/ci-rules.ts'
import {TOOLS} from '../../lib/gates.ts'
import {git, relativeTo} from '../../lib/repo.ts'

export interface ExplainOptions {
  files: string[]
  base: string
  event: string
  labels: string[]
}

export function ciExplainReport(root: string, {files, base, event, labels}: ExplainOptions) {
  const facts = repoFacts(root)
  const rules = loadCiRules(root)
  // Named files are compared, like a lockfile, with their versions at the merge base when there is one.
  const commit = git(root, ['merge-base', 'HEAD', base])
  // Repository-relative, as Git lists changed files: `./a/b`, `a//b` and absolute paths inside the checkout too.
  const named = files.map(file => posix.normalize(relativeTo(root, file)).replace(/\/$/u, ''))
  const change = named.length
    ? {paths: named, contents: commit === undefined ? undefined : contentsSince(root, commit)}
    : changeSince(root, base)
  const plan = ciPlan(facts, rules, {paths: change.paths, event, labels, ...(change.contents ? {contents: change.contents} : {})})
  return {
    base: files.length ? 'the named files' : `${base} (merge base ${(commit ?? '').slice(0, 12)})`,
    ...explain(plan, rules, facts),
    next: [`node tools/scripts/ci-plan.mjs --base ${base}`, `${TOOLS} test tools/cli`],
  }
}

export interface ReplayOptions {
  base: string
  commits: number
  files: boolean
}

/** `ci replay`: the plans under the rules and planner at `base` and in the working tree, compared. */
export async function ciReplayReport(root: string, {base, commits, files}: ReplayOptions) {
  const checkout = checkoutPlanner(root, base)
  try {
    const before = await loadPlanner(root, join(checkout.directory, 'tools/cli/src/lib'), checkout.directory, executions)
    const after = await loadPlanner(root, join(root, 'tools/cli/src/lib'), root)
    const tracked = files ? (git(root, ['ls-files']) ?? '').split('\n').filter(Boolean) : undefined
    const result = replay(before, after, mergedCommits(root, base, commits), tracked, root)
    const percent = (a: number, b: number) => (a ? `${b >= a ? '+' : ''}${(((b - a) / a) * 100).toFixed(1)}%` : 'n/a')
    const {before: was, after: is, selective} = result.commits
    return {
      base,
      summary: [
        `${commits} commits on ${base} (${result.commits.full} ran everything): ${was.runners} → ${is.runners} runners, ${was.minutes} → ${is.minutes} runner-minutes (${percent(was.minutes, is.minutes)}), macOS ${was.macos} → ${is.macos}`,
        `Those that followed their change: ${selective.before.minutes} → ${selective.after.minutes} runner-minutes (${percent(selective.before.minutes, selective.after.minutes)})`,
        ...(result.files
          ? [
              `${result.files.changed} of ${result.files.count} tracked files alone plan differently, ${result.files.minutes >= 0 ? '+' : ''}${result.files.minutes} runner-minutes in all`,
            ]
          : []),
      ],
      ...result,
      next: [`${TOOLS} ci explain <file> --base ${base}`],
    }
  } finally {
    checkout.remove()
  }
}
