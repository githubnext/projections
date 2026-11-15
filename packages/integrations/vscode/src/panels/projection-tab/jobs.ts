// A projection tab's extraction jobs: which of its page's requests start one, and, for tests, how long each new one is
// held before it reaches the backend.
import {parseTransportMessage} from '@githubnext/projections-inspector/transport'

/**
 * For tests: how long a projection tab holds each new extraction job before it reaches the backend, from
 * `PROJECTIONS_TEST_HOLD_JOB_MS` or the test API's `holdJobs`. 0, as always outside tests: not at all.
 */
let jobHoldMs = Number(process.env['PROJECTIONS_TEST_HOLD_JOB_MS'] ?? 0) || 0

/** For tests: holds each new extraction job `ms` before it reaches the backend (0: not at all), to see a long job. */
export function holdJobs(ms: number) {
  jobHoldMs = ms
}

/** Whether a request from the page starts a new extraction job. */
export const startsJob = (method: string, path: string) => method === 'POST' && /^\/api\/jobs(\?|$)/.test(path)

/** For tests: how long to hold a message from the page before it reaches the backend; 0 unless it starts a job. */
export function jobHold(message: unknown): number {
  if (jobHoldMs <= 0) return 0
  const request = parseTransportMessage(message)
  return request?.type === 'request' && startsJob(request.method, request.path) ? Math.min(jobHoldMs, 60_000) : 0
}
