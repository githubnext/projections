// The environment and provenance, without VS Code, for tests: preparing a folder's environment through its backend
// (`POST /api/prepare`, then `GET /api/prepare/:id` until it finishes), the lines its output channel shows, the
// backend arguments a workspace strategy adds, and the provenance badge an extraction's run earns.
import type {Runner} from './runner.js'

/** What `POST /api/prepare` and `GET /api/prepare/:id` return. */
export interface PrepareRun {
  id: string
  status: 'running' | 'succeeded' | 'failed' | 'cancelled'
  revision?: string | null
  events: PrepareEvent[]
  error?: string
  report?: {target: string; root: string; strategy?: string; steps: {id: string; status: string; durationMs?: number}[]}
  /** The latest step's log, as it is now (its end). */
  log?: string
}

export interface PrepareEvent {
  step: string
  event: 'start' | 'skip' | 'succeeded' | 'failed'
  run?: string[]
  log?: string
  reason?: string
  error?: string
  durationMs?: number
}

/** One line for the prepare output channel. */
export function eventLine(event: PrepareEvent): string {
  switch (event.event) {
    case 'start':
      return `▶ ${event.step}: ${(event.run ?? []).join(' ')}${event.log ? ` (log: ${event.log})` : ''}`
    case 'skip':
      return `✓ ${event.step}: up to date (${event.reason ?? 'unchanged'})`
    case 'succeeded':
      return `✓ ${event.step}: done in ${((event.durationMs ?? 0) / 1000).toFixed(1)} s`
    case 'failed':
      return `✗ ${event.step}: ${event.error ?? 'failed'}${event.log ? ` (log: ${event.log})` : ''}`
  }
}

/**
 * Prepares the environment through a backend: starts the run, reports each new event's line, and returns the
 * finished run. Aborting `signal` cancels it in the backend.
 */
export async function prepareEnvironment(
  runner: Pick<Runner, 'request'>,
  options: {revision?: string; steps?: string[]; force?: boolean},
  report: (line: string) => void,
  signal?: AbortSignal,
  pollMs = 300,
): Promise<PrepareRun> {
  const body: Record<string, unknown> = {}
  if (options.revision) body.revision = options.revision
  if (options.steps?.length) body.steps = options.steps
  if (options.force) body.force = true
  const started = await runner.request({method: 'POST', path: '/api/prepare', body})
  if (started.status !== 202) throw new Error(refusal(started.body) ?? `Preparing failed (${started.status})`)
  const id = (started.body as PrepareRun).id
  const cancel = () => void runner.request({method: 'POST', path: `/api/prepare/${id}/cancel`}).catch(() => {})
  signal?.addEventListener('abort', cancel, {once: true})
  let shown = 0
  try {
    for (;;) {
      const response = await runner.request({method: 'GET', path: `/api/prepare/${id}`})
      if (response.status !== 200) throw new Error(refusal(response.body) ?? `Preparing failed (${response.status})`)
      const run = response.body as PrepareRun
      for (const event of run.events.slice(shown)) report(eventLine(event))
      shown = run.events.length
      if (run.status !== 'running') return run
      await new Promise(resolve => setTimeout(resolve, pollMs))
    }
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
}

function refusal(body: unknown): string | undefined {
  const error = (body as {error?: unknown} | undefined)?.error
  return typeof error === 'string'
    ? error
    : typeof (error as {message?: unknown})?.message === 'string'
      ? String((error as {message: string}).message)
      : undefined
}

/** The backend arguments for the `projections.workspace` setting: `--workspace STRATEGY`, or none. */
export function workspaceArguments(setting: unknown): string[] {
  return typeof setting === 'string' && ['fresh', 'worktree', 'clone', 'sparse', 'none'].includes(setting) ? ['--workspace', setting] : []
}

/** The badge an extraction's run earns, from `provenance.execution`: who observed it, and how faithfully. */
export interface ProvenanceBadge {
  label: 'From CI' | 'Imported' | 'Local' | 'Approximate' | 'Stale' | 'Observed'
  detail: string
}

export function provenanceBadge(document: unknown): ProvenanceBadge | undefined {
  const execution = (document as {provenance?: {execution?: Record<string, unknown>}} | undefined)?.provenance?.execution
  if (!execution || typeof execution.source !== 'string') return undefined
  const at = typeof execution.at === 'string' ? ` at ${execution.at}` : ''
  if (execution.fidelity === 'stale') return {label: 'Stale', detail: 'The working tree changed while it was extracted; extract it again.'}
  if (execution.fidelity === 'approximate') {
    return {label: 'Approximate', detail: "Extracted with the working tree's dependencies, whose lockfiles differ from this revision's."}
  }
  if (execution.source === 'ci') {
    const ci = execution.ci as {repository?: string; run?: number} | undefined
    const run = `CI run ${ci?.run ?? '?'} of ${ci?.repository ?? 'this repository'}`
    // Only an authenticated artifact is official; an imported one only claims its run.
    return execution.official === true
      ? {label: 'From CI', detail: `The official extraction, published by ${run}${at}.`}
      : {label: 'Imported', detail: `Imported from an artifact that names ${run}${at}; unauthenticated, so not the official extraction.`}
  }
  if (execution.determinism === 'observed') return {label: 'Observed', detail: `An observation of varying data, made locally${at}.`}
  const where: Record<string, string> = {
    'local-in-place': 'in your checkout',
    'local-git-objects': "from Git's objects",
    'local-workspace': `in a ${typeof execution.strategy === 'string' ? execution.strategy : ''} workspace`,
    'local-materialized': 'in a temporary copy',
  }
  return {label: 'Local', detail: `Extracted on this machine ${where[execution.source] ?? ''}${at}.`.replace(/\s+/g, ' ')}
}
