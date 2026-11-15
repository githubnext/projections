import {parentPort} from 'node:worker_threads'
import {execute, type ExecuteRequest} from './execute.js'

if (!parentPort) throw new Error('node-worker-entry must run in a worker thread')
const port = parentPort
port.once('message', (request: ExecuteRequest) => port.postMessage(execute(request)))
