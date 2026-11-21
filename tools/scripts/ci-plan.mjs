#!/usr/bin/env node
// Decides what the Projections workflow (.github/workflows/ci.yml) runs for a change: CONTRIBUTING.md#what-ci-runs.
// The rules are .github/ci-rules.json; tools/cli/src/lib/ci-plan.ts applies them to the workspace and crate graph. This
// runs it on Git's list of changed files. It needs no npm install, so CI's `changes` job runs it straight after
// checkout.
//
//   node tools/scripts/ci-plan.mjs                     what a pull request from this branch runs (since origin/main)
//   node tools/scripts/ci-plan.mjs --base REF          files changed since the merge base with REF
//   node tools/scripts/ci-plan.mjs --event push        a run for that GitHub Actions event (the rules' full.events)
//   node tools/scripts/ci-plan.mjs --labels a,b        a pull request with those labels (the rules' full.labels)
//
// In GitHub Actions it writes each job's decision (by job ID), each condition, the affected suites and the browser
// matrices to the step's outputs, and the jobs with their reasons to its summary; elsewhere it prints the plan as JSON.
import {appendFileSync, readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'
import {repoFacts} from '../cli/src/lib/ci-facts.ts'
import {ciPlan, planOutputs} from '../cli/src/lib/ci-plan.ts'
import {loadCiRules} from '../cli/src/lib/ci-rules.ts'
import {changedFiles} from '../cli/src/lib/git.ts'
import {git} from '../cli/src/lib/repo.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const {values} = parseArgs({
  options: {
    base: {type: 'string', default: 'origin/main'},
    event: {type: 'string', default: 'pull_request'},
    labels: {type: 'string', default: ''},
  },
})
// Committed, staged, unstaged and untracked changes since the merge base, as `tools affected` lists them; in CI, the
// pull request's merge commit against its base.
const commit = git(root, ['merge-base', 'HEAD', values.base])
if (commit === undefined) throw new Error(`No merge base with ${values.base}; fetch it, or pass --base`)
const paths = changedFiles(root, {ref: values.base, commit, reason: '--base'}).map(change => change.path)
const labels = values.labels.split(',').filter(Boolean)
// The lockfile rules compare a lockfile with its version at the merge base.
const contents = {
  before: path => git(root, ['show', `${commit}:${path}`]),
  after: path => {
    try {
      return readFileSync(new URL(path, `file://${root}`), 'utf8')
    } catch {
      return undefined
    }
  },
}
const plan = ciPlan(repoFacts(root), loadCiRules(root), {paths, event: values.event, labels, contents})

const outputs = planOutputs(plan)

const list = items => (items.length ? items.map(item => `\`${item}\``).join(', ') : 'none')
const runs = value => (Array.isArray(value) ? list(value) : value ? 'yes' : 'no')
// When the run follows the change, each file's class and why, up to a screenful; beyond that, the count of each class.
const files = plan.full.length
  ? []
  : plan.files.length <= 40
    ? plan.files.map(file => `- \`${file.path}\`: ${file.class}. ${file.rule}`)
    : Object.entries(Object.groupBy(plan.files, file => file.class)).map(([name, items]) => `- ${items.length} ${name}`)
const summary = [
  '## What CI runs',
  '',
  plan.full.length ? `Everything runs: ${plan.full.join('; ')}.` : `${plan.files.length} changed files, by .github/ci-rules.json.`,
  '',
  ...files,
  '',
  `- Touched: ${list(plan.changed)}`,
  `- Reached through them: ${list(Object.entries(plan.dependants).map(([unit, via]) => `${unit} (through ${via})`))}`,
  '',
  '| Job | Runs | Why |',
  '| --- | --- | --- |',
  ...Object.entries(plan.jobs).map(([job, value]) => `| ${job} | ${runs(value)} | ${(plan.why[job] ?? []).join('; ')} |`),
  `| browser | ${list(plan.browser.map(job => job.name))} | |`,
  `| browser-macos | ${list(plan.browserMacos.map(job => job.name))} | |`,
  '',
  `Browser suites: ${list(plan.suites)}${plan.renderers.length ? `; the renderer harness limited to ${list(plan.renderers)}` : ''}.`,
  '',
].join('\n')

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(outputs)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(''),
  )
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
  console.log(summary)
} else {
  console.log(JSON.stringify(plan, null, 2))
}
