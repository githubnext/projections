import {runInWorker} from './host.js'
import type {ExecuteRequest} from './execute.js'

/** Runs one request in a fresh module Web Worker, terminated at the deadline. */
export function run(
  request: ExecuteRequest,
  deadlineMs: number,
  workerUrl: URL | string | undefined,
  signal?: AbortSignal,
): Promise<unknown> {
  return runInWorker(
    events => {
      const worker = new Worker(workerUrl ?? new URL('./worker-entry.js', import.meta.url), {type: 'module'})
      worker.addEventListener('message', event => events.message(event.data))
      worker.addEventListener('messageerror', () => events.error('uncloneable message'))
      worker.addEventListener('error', event => {
        event.preventDefault()
        events.error(event.message || 'worker error')
      })
      return {
        post: request => worker.postMessage(request, [request.input.buffer]),
        terminate: () => worker.terminate(),
      }
    },
    request,
    deadlineMs,
    signal,
  )
}
