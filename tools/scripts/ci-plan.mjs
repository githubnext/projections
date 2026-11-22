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
//   node tools/scripts/ci-plan.mjs --plan FILE         also write the plan and its checks as JSON
//
// `npm run tools -- ci explain` says why the plan runs or skips each job.
//
// In GitHub Actions it writes each job's decision (by job ID), each condition, the affected suites and the browser
// matrices to the step's outputs, and the jobs with their reasons to its summary; elsewhere it prints the plan as JSON.
import {appendFileSync, writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'
import {changeSince} from '../cli/src/lib/ci-change.ts'
import {repoFacts} from '../cli/src/lib/ci-facts.ts'
import {ciPlan, executions, planOutputs} from '../cli/src/lib/ci-plan.ts'
import {loadCiRules} from '../cli/src/lib/ci-rules.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const {values} = parseArgs({
  options: {
    base: {type: 'string', default: 'origin/main'},
    event: {type: 'string', default: 'pull_request'},
    labels: {type: 'string', default: ''},
    plan: {type: 'string'},
  },
})
// Committed, staged, unstaged and untracked changes since the merge base, as `tools affected` lists them; in CI, the
// pull request's merge commit against its base. Lockfiles are compared with their versions at the merge base.
const {commit, paths, contents} = changeSince(root, values.base)
const labels = values.labels.split(',').filter(Boolean)
const rules = loadCiRules(root)
const plan = ciPlan(repoFacts(root), rules, {paths, event: values.event, labels, contents})
// The plan, with the checks it runs, for the workflow's artifact: what a run decided and why, after the fact.
if (values.plan)
  writeFileSync(
    values.plan,
    `${JSON.stringify({base: commit, event: values.event, labels, plan, checks: executions(plan, rules)}, null, 2)}\n`,
  )

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
