#!/usr/bin/env node
// Decides what the Projections workflow (.github/workflows/ci.yml) runs for a change: CONTRIBUTING.md#what-ci-runs.
// The logic is tools/cli/src/lib/ci-plan.ts, which reads the workspace and crate graph; this runs it on Git's list of
// changed files. It needs no npm install, so CI's `changes` job runs it straight after checkout.
//
//   node tools/scripts/ci-plan.mjs                 what a pull request from this branch runs (since origin/main)
//   node tools/scripts/ci-plan.mjs --base REF      files changed since the merge base with REF
//   node tools/scripts/ci-plan.mjs --full REASON   everything, for REASON (a push, the nightly run, the ci:full label)
//
// In GitHub Actions it writes the plan to the step's outputs and summary; elsewhere it prints it as JSON.
import {appendFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {parseArgs} from 'node:util'
import {repoFacts} from '../cli/src/lib/ci-facts.ts'
import {ciPlan} from '../cli/src/lib/ci-plan.ts'
import {changedFiles} from '../cli/src/lib/git.ts'
import {git} from '../cli/src/lib/repo.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const {values} = parseArgs({options: {base: {type: 'string', default: 'origin/main'}, full: {type: 'string', multiple: true}}})
// Committed, staged, unstaged and untracked changes since the merge base, as `tools affected` lists them; in CI, the
// pull request's merge commit against its base.
const commit = git(root, ['merge-base', 'HEAD', values.base])
if (commit === undefined) throw new Error(`No merge base with ${values.base}; fetch it, or pass --base`)
const paths = changedFiles(root, {ref: values.base, commit, reason: '--base'}).map(change => change.path)
const plan = ciPlan(repoFacts(root), paths, values.full ?? [])

const outputs = {
  full: plan.full.length > 0,
  docs_only: plan.flags.docsOnly,
  rust: plan.flags.rust,
  engine: plan.flags.engine,
  renderers: plan.flags.renderers.join(','),
  host: plan.flags.host,
  inspector: plan.flags.inspector,
  storybook: plan.flags.storybook,
  cli: plan.flags.cli,
  action: plan.flags.action,
  windows_relevant: plan.flags.windows,
  release_relevant: plan.flags.release,
  workflows: plan.flags.workflows,
  docs: plan.jobs.docs,
  product: JSON.stringify(plan.jobs.product),
  verus: plan.jobs.verus,
  windows: plan.jobs.windows,
  windows_node: plan.jobs.windowsNode,
  package: plan.jobs.package,
  release: plan.jobs.release,
  coverage: plan.jobs.coverage,
  mutants: plan.jobs.mutants,
  actions_lock: plan.jobs.actionsLock,
  browser: JSON.stringify(plan.browser),
  browser_macos: JSON.stringify(plan.browserMacos),
}

const list = items => (items.length ? items.map(item => `\`${item}\``).join(', ') : 'none')
const summary = [
  '## What CI runs',
  '',
  plan.full.length ? `Everything: ${plan.full.join('; ')}.` : `${plan.files} changed files.`,
  '',
  `- Changed: ${list(plan.changed)}`,
  `- Depending on them: ${list(plan.dependants)}`,
  `- Generators: ${list(plan.generators)}`,
  '',
  '| Job | Runs |',
  '| --- | --- |',
  `| docs (format, lint, links) | ${plan.jobs.docs} |`,
  `| public-product | ${list(plan.jobs.product)} |`,
  ...['verus', 'windows', 'windowsNode', 'package', 'release', 'coverage', 'mutants', 'actionsLock'].map(
    job => `| ${job} | ${plan.jobs[job]} |`,
  ),
  `| browser | ${list(plan.browser.map(job => job.name))} |`,
  `| browser-macos | ${list(plan.browserMacos.map(job => job.name))} |`,
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
