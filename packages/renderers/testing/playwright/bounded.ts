// A bound on each request a test makes of the stage page, kept in the test process.
import type {StageState} from '../src/types.js'

const noop = () => undefined

/**
 * How long one stage request may take before it fails, ms. The stage's own waits are bounded in the page (a frame's
 * arrival at its height at 60 s, a probe measurement at 10 s) and a heavy scenario loads in under 15 s on a slow
 * runner, so a request still unanswered after this is stuck: a renderer that never acknowledged a paint (`seek` waits
 * for it with no bound of its own), or a page that no longer runs. The bound is in the test process because the page's
 * own timers can't fire in the second case: WebKit runs the sandboxed renderer frame in the host page's process,
 * so a renderer stuck in its document, or a web process exhausted by the frames WebKit keeps (`framesPerStagePage`),
 * stops the host's event loop with it.
 */
export const stageRequestTimeoutMs = 90_000

/** What the test last heard from the stage, for a request that goes unanswered. */
export class StageRecord {
  scenario: string | undefined
  state: StageState | undefined
  answered: string | undefined
  at = Date.now()

  /** Notes a request's answer: a state it returned, and that the page still answered then. */
  heard(what: string, value: unknown): void {
    this.answered = what
    this.at = Date.now()
    if (isState(value)) this.state = value
  }

  /** The stage's last known state, in a line. */
  describe(): string {
    const state = this.state
    const shown = state
      ? `status ${state.status}${state.bundle ? `, renderer ${state.bundle}` : ''}${state.comparisonMode ? `, ${state.comparisonMode}` : ''}, progress ${state.progress}, painted ${state.rendered ?? 'nothing'}${state.height === undefined ? '' : `, asked for ${state.height}px`}${state.errors.length ? `, errors: ${state.errors.join('; ')}` : ''}`
      : 'no state yet'
    const last = this.answered ? `; it last answered ${this.answered} ${((Date.now() - this.at) / 1000).toFixed(1)} s before` : ''
    return `${shown}${last}`
  }
}

function isState(value: unknown): value is StageState {
  return typeof value === 'object' && value !== null && 'status' in value && 'progress' in value && 'errors' in value
}

/**
 * Resolves with `request`, or fails after `stageRequestTimeoutMs` naming it, the scenario and the stage's last known
 * state. A request left unanswered is rejected once Playwright closes the page; that rejection is ignored.
 */
export async function bounded<T>(record: StageRecord, what: string, request: Promise<T>, timeoutMs = stageRequestTimeoutMs): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      request.catch(noop)
      const scenario = record.scenario ? ` for ${record.scenario}` : ''
      reject(
        new Error(
          `The stage page didn't answer ${what}${scenario} within ${timeoutMs / 1000} s: a renderer that never acknowledged its paint, or a page (with the renderer frame in its process) that stopped running. Last known: ${record.describe()}.`,
        ),
      )
    }, timeoutMs)
  })
  try {
    const value = await Promise.race([request, expired])
    record.heard(what, value)
    return value
  } finally {
    clearTimeout(timer)
  }
}
