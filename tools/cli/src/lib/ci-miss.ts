// Whether a job that failed on main was a miss of the CI rules: a job the merged pull request's plan skipped, which
// passed on the parent commit's run. tools/scripts/ci-miss.mjs reads the runs, the plan artifact and the parent's jobs
// from GitHub and reports; this decides. It only reports: it files nothing and re-runs nothing.

/** A failed job's verdict. */
export type Verdict =
  /** The plan skipped it and it passed on the parent commit: the rules probably missed what this change reaches. */
  | 'likely miss'
  /** The plan skipped it, and the parent commit gives no evidence either way: no run, or the job didn't finish there. */
  | 'skipped, no baseline'
  /** It also failed or timed out on the parent commit: it was already broken. */
  | 'failing before'
  /** The pull request ran it: not a rules question (a flaky test, or the merge with other changes). */
  | 'ran on the pull request'
  /** The plan doesn't gate it: it runs on every change. */
  | 'not gated'
  /** The pull request's plan isn't available (no artifact, or no pull request). */
  | 'no plan'

export interface MissInput {
  /** Names of the jobs that failed or timed out on main, as GitHub lists them. */
  failed: readonly string[]
  /** The merged pull request's plan: the job IDs it gates, and the checks it ran. */
  plan?: {gated: readonly string[]; checks: readonly string[]}
  /** The parent commit's run on main: each job's conclusion by name. */
  parent?: Readonly<Record<string, string>>
}

export interface Miss {
  job: string
  verdict: Verdict
}

/** A job's ID: its name before ` (`, the matrix entry. */
const jobId = (name: string) => name.replace(/ \(.*$/, '')

/** Whether the plan ran a job: a check of that name, or the check a workflow-sharded job (mutants-diff (3)) belongs to. */
const ran = (checks: readonly string[], name: string) => checks.some(check => check === name || name.startsWith(`${check} (`))

export function misses({failed, plan, parent}: MissInput): Miss[] {
  return failed.map(job => {
    if (!plan) return {job, verdict: 'no plan'}
    if (!plan.gated.includes(jobId(job))) return {job, verdict: 'not gated'}
    if (ran(plan.checks, job)) return {job, verdict: 'ran on the pull request'}
    const before = parent?.[job]
    if (before === 'success') return {job, verdict: 'likely miss'}
    // Skipped, cancelled or missing on the parent (say its `changes` job failed): no baseline, not a known failure.
    if (before === 'failure' || before === 'timed_out') return {job, verdict: 'failing before'}
    return {job, verdict: 'skipped, no baseline'}
  })
}
