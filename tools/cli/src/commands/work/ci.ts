// `ci explain`: what CI runs for a change and why, from the plan CI's `changes` job makes (CONTRIBUTING.md#what-ci-runs).
import {repoFacts} from '../../lib/ci-facts.ts'
import {changeSince, contentsSince} from '../../lib/ci-change.ts'
import {explain} from '../../lib/ci-explain.ts'
import {ciPlan} from '../../lib/ci-plan.ts'
import {loadCiRules} from '../../lib/ci-rules.ts'
import {TOOLS} from '../../lib/gates.ts'
import {posix} from 'node:path'
import {git, relativeTo} from '../../lib/repo.ts'

export type ExplainOptions = {files: string[]; base: string; event: string; labels: string[]}

export function ciExplainReport(root: string, {files, base, event, labels}: ExplainOptions) {
  const facts = repoFacts(root)
  const rules = loadCiRules(root)
  // Named files are compared, like a lockfile, with their versions at the merge base when there is one.
  const commit = git(root, ['merge-base', 'HEAD', base])
  // Repository-relative, as Git lists changed files: `./a/b`, `a//b` and absolute paths inside the checkout too.
  const named = files.map(file => posix.normalize(relativeTo(root, file)).replace(/\/$/, ''))
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
