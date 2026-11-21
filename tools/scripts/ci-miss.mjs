#!/usr/bin/env node
// The miss detector (CONTRIBUTING.md#what-ci-runs), on a push to main once every job has finished: for each job that
// failed, did the merged pull request's plan skip it, and did it pass on the parent commit? Then the rules probably
// missed what the change reaches. It reports in the run's summary and as warnings, and always exits 0: it files no
// issues and re-runs nothing. It reads the GitHub API with `gh` (GH_TOKEN, GITHUB_REPOSITORY, GITHUB_RUN_ID,
// GITHUB_SHA); the plan is the `ci-plan` artifact of the pull request's last run (tools/scripts/ci-plan.mjs --plan).
import {spawnSync} from 'node:child_process'
import {appendFileSync, existsSync, mkdtempSync, readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {misses} from '../cli/src/lib/ci-miss.ts'

const {GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: run, GITHUB_SHA: sha} = process.env
const workflow = process.env.WORKFLOW ?? 'Projections'
const notes = []

function gh(...args) {
  const result = spawnSync('gh', args, {encoding: 'utf8', maxBuffer: 1 << 26})
  if (result.status !== 0) throw new Error(`gh ${args.join(' ')}: ${result.stderr.trim()}`)
  return result.stdout
}
const api = path => JSON.parse(gh('api', path))
const jobs = id =>
  api(`repos/${repo}/actions/runs/${id}/jobs?per_page=100&filter=latest`).jobs.map(job => ({name: job.name, conclusion: job.conclusion}))

/** The merged pull request's plan, from its last run's `ci-plan` artifact. */
function plan() {
  const [pr] = api(`repos/${repo}/commits/${sha}/pulls`)
  if (!pr) return (notes.push('No pull request merged this commit.'), undefined)
  const runs = api(`repos/${repo}/actions/runs?event=pull_request&head_sha=${pr.head.sha}&per_page=20`).workflow_runs
  const last = runs.find(item => item.name === workflow)
  if (!last) return (notes.push(`No ${workflow} run of #${pr.number}'s head ${pr.head.sha.slice(0, 12)}.`), undefined)
  const directory = mkdtempSync(join(tmpdir(), 'ci-miss-'))
  try {
    gh('run', 'download', String(last.id), '--repo', repo, '--name', 'ci-plan', '--dir', directory)
  } catch {
    return (notes.push(`#${pr.number}'s run ${last.id} has no ci-plan artifact.`), undefined)
  }
  const file = join(directory, 'ci-plan.json')
  if (!existsSync(file)) return (notes.push(`#${pr.number}'s ci-plan artifact has no ci-plan.json.`), undefined)
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  notes.push(`The plan of #${pr.number} (run ${last.id}).`)
  return {gated: [...Object.keys(saved.plan.jobs), 'browser', 'browser-macos'], checks: saved.checks.map(check => check.check)}
}

/** The parent commit's run on main: each job's conclusion by name. */
function parent() {
  const commit = api(`repos/${repo}/commits/${sha}`).parents[0]?.sha
  const runs = commit ? api(`repos/${repo}/actions/runs?event=push&head_sha=${commit}&per_page=20`).workflow_runs : []
  const last = runs.find(item => item.name === workflow && item.status === 'completed')
  if (!last) return (notes.push('No completed run of the parent commit to compare with.'), undefined)
  return Object.fromEntries(jobs(last.id).map(job => [job.name, job.conclusion]))
}

let lines
try {
  const failed = jobs(run)
    // ci-ok fails when another job does; this job is the detector itself.
    .filter(job => ['failure', 'timed_out'].includes(job.conclusion) && !['ci-ok', 'ci-miss'].includes(job.name))
    .map(job => job.name)
  if (!failed.length) lines = ['No job failed.']
  else {
    const found = misses({failed, plan: plan(), parent: parent()})
    for (const {job, verdict} of found)
      if (verdict === 'likely miss')
        console.log(
          `::warning title=CI rules miss?::${job} failed on main, passed on the parent commit, and the pull request's plan skipped it`,
        )
    lines = ['| Failed job | Verdict |', '| --- | --- |', ...found.map(({job, verdict}) => `| ${job} | ${verdict} |`)]
  }
} catch (error) {
  lines = [`The miss detector couldn't decide: ${error.message}`]
}
const summary = ['## CI rules misses', '', ...notes, '', ...lines, ''].join('\n')
console.log(summary)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
