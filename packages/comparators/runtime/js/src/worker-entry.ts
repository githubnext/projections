/// <reference lib="webworker" />
import {execute, type ExecuteRequest} from './execute.js'

declare const self: DedicatedWorkerGlobalScope

self.addEventListener('message', (event: MessageEvent<ExecuteRequest>) => {
  self.postMessage(execute(event.data))
})
