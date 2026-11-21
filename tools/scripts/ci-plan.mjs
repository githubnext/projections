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
import {ciPlan} from '../cli/src/lib/ci-plan.ts'
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

const outputs = {
  full: plan.full.length > 0,
  'docs-only': plan.docsOnly,
  ...Object.fromEntries(Object.entries(plan.conditions).map(([name, value]) => [`if-${name}`, value])),
  ...Object.fromEntries(Object.entries(plan.jobs).map(([name, value]) => [name, Array.isArray(value) ? JSON.stringify(value) : value])),
  suites: JSON.stringify(plan.suites),
  renderers: plan.renderers.join(','),
  browser: JSON.stringify(plan.browser),
  'browser-macos': JSON.stringify(plan.browserMacos),
}

const list = items => (items.length ? items.map(item => `\`${item}\``).join(', ') : 'none')
const runs = value => (Array.isArray(value) ? list(value) : value ? 'yes' : 'no')
const summary = [
  '## What CI runs',
  '',
  plan.full.length ? `Everything runs: ${plan.full.join('; ')}.` : `${plan.files} changed files, by .github/ci-rules.json.`,
  '',
  `- Changed: ${list(plan.changed)}`,
  `- Depending on them: ${list(plan.dependants)}`,
  `- Generators: ${list(plan.generators)}`,
  '',
  '| Job | Runs | Why |',
  '| --- | --- | --- |',
  ...Object.entries(plan.jobs).map(([job, value]) => `| ${job} | ${runs(value)} | ${(plan.why[job] ?? []).join('; ')} |`),
  `| browser | ${list(plan.browser.map(job => job.name))} | |`,
  `| browser-macos | ${list(plan.browserMacos.map(job => job.name))} | |`,
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
