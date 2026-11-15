import {Worker} from 'node:worker_threads'
import {runInWorker} from './host.js'
import type {ExecuteRequest} from './execute.js'

/** Runs one request in a fresh `worker_threads` Worker, terminated at the deadline. */
export function run(request: ExecuteRequest, deadlineMs: number): Promise<unknown> {
  return runInWorker(
    events => {
      const worker = new Worker(new URL('./node-worker-entry.js', import.meta.url))
      worker.on('message', data => events.message(data))
      worker.on('messageerror', () => events.error('uncloneable message'))
      worker.on('error', error => events.error(error.message))
      worker.on('exit', code => events.error(`worker exited with code ${code}`))
      return {
        post: request => worker.postMessage(request, [request.input.buffer as ArrayBuffer]),
        terminate: () => void worker.terminate(),
      }
    },
    request,
    deadlineMs,
  )
}
