import type {ProjectionEngine} from '@githubnext/projections-schemas'
import type {WasmEngineOptions} from './wasm-transport.js'
import type {ComparatorModuleOptions} from './comparator-transport.js'
import {decodeResponse} from './decoding.js'
import {encode} from './encoding.js'
import {engine} from './engine.js'
import {EngineTransportError} from './transport.js'

export {EngineError, EngineTransportError, limits} from './transport.js'

/** How `createWorkerEngine` starts its Worker and loads the engine inside it. */
export interface WorkerEngineOptions {
  /** The Worker script; defaults to the packaged `worker-entry.js` beside this module. Must satisfy the page's CSP. */
  workerUrl?: URL | string
  /** The engine module the Worker loads, as `createWasmEngine` takes it; a URL is passed as a string. */
  wasm?: WasmEngineOptions
  /** The default comparator module; defaults to the packaged `artifacts/default-comparator.wasm`. */
  comparator?: ComparatorModuleOptions
  /** Applies to initialization and each queued request; timeout terminates the worker. */
  timeoutMs?: number
}

/** The engine running in a dedicated Worker, which `dispose` terminates. */
export interface WorkerEngine extends ProjectionEngine {
  /** Idempotent. Rejects every pending request and prevents future calls. */
  dispose(): void
}

interface Pending {
  resolve(bytes: Uint8Array): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Creates the engine in a module Worker, so semantic work and comparisons run off the calling thread; encoding requests
 * and decoding results still happen on it. Resolves once the Worker has loaded both modules. Requests queue in order,
 * and `timeoutMs` covers each one's wait in the queue. Any failure (a crash, an invalid or unknown reply, a timeout, a
 * disposal) terminates the Worker and rejects every pending and future call with `EngineTransportError`; create a new
 * engine to recover.
 *
 * @param options - The Worker script, engine and comparator modules, and the startup and per-request timeout.
 * @returns The engine, with `dispose` to terminate its Worker.
 * @throws `RangeError` when `timeoutMs` is outside 1–300000, and `EngineTransportError` when the Worker fails or times
 *   out while starting.
 *
 * @example
 * ```ts
 * import {createWorkerEngine} from '@githubnext/projections-engine/worker'
 *
 * const engine = await createWorkerEngine()
 * try {
 *   const comparison = await engine.compare(before, after)
 * } finally {
 *   engine.dispose()
 * }
 * ```
 */
export async function createWorkerEngine(options: WorkerEngineOptions = {}): Promise<WorkerEngine> {
  const timeoutMs = options.timeoutMs ?? 30_000
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new RangeError('timeoutMs must be between 1 and 300000')
  }
  const worker = new Worker(options.workerUrl ?? new URL('./worker-entry.js', import.meta.url), {type: 'module'})
  const pending = new Map<number, Pending>()
  let nextId = 0
  let failure: EngineTransportError | undefined
  let initialized = false
  let digest = ''
  const listening = new AbortController()
  let readyResolve: () => void
  let readyReject: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve
    readyReject = reject
  })
  const stop = (error: EngineTransportError): void => {
    if (failure) return
    failure = error
    clearTimeout(startup)
    worker.terminate()
    listening.abort()
    readyReject(error)
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  }
  const startup = setTimeout(
    () => stop(new EngineTransportError(`Engine worker initialization timed out after ${timeoutMs} ms`)),
    timeoutMs,
  )
  const failed = (event: ErrorEvent) => {
    event.preventDefault()
    stop(new EngineTransportError(`Engine worker failed: ${event.message}`))
  }
  const uncloneable = () => stop(new EngineTransportError('Engine worker returned an uncloneable message'))
  const received = (event: MessageEvent<unknown>) => {
    const message = event.data
    if (message === null || typeof message !== 'object' || !('type' in message)) {
      stop(new EngineTransportError('Engine worker returned an invalid message'))
      return
    }
    if (message.type === 'ready' && !initialized) {
      if (!('digest' in message) || typeof message.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(message.digest)) {
        stop(new EngineTransportError('Engine worker returned an invalid comparator digest'))
        return
      }
      initialized = true
      digest = message.digest
      clearTimeout(startup)
      readyResolve()
      return
    }
    if (message.type === 'failure' && 'message' in message && typeof message.message === 'string') {
      stop(new EngineTransportError(`Engine worker failed: ${message.message}`))
      return
    }
    if (
      message.type !== 'response' ||
      !initialized ||
      !('id' in message) ||
      typeof message.id !== 'number' ||
      !('bytes' in message) ||
      !(message.bytes instanceof Uint8Array)
    ) {
      stop(new EngineTransportError('Engine worker returned an invalid message'))
      return
    }
    const request = pending.get(message.id)
    if (!request) {
      stop(new EngineTransportError('Engine worker returned an unknown request ID'))
      return
    }
    pending.delete(message.id)
    clearTimeout(request.timer)
    request.resolve(message.bytes)
  }
  const {signal} = listening
  worker.addEventListener('error', failed, {signal})
  worker.addEventListener('messageerror', uncloneable, {signal})
  worker.addEventListener('message', received, {signal})
  try {
    const wasm = options.wasm
    const comparator = options.comparator
    worker.postMessage({
      type: 'init',
      options: wasm?.module === undefined ? (wasm?.url === undefined ? {} : {url: String(wasm.url)}) : {module: wasm.module},
      comparator:
        comparator?.module === undefined
          ? comparator?.url === undefined
            ? {}
            : {url: String(comparator.url)}
          : {module: comparator.module},
    })
  } catch (cause) {
    stop(new EngineTransportError('Cannot initialize engine worker', {cause}))
  }
  await ready
  const send = (type: 'request' | 'compare', input: Uint8Array): Promise<Uint8Array> => {
    if (failure) throw failure
    const id = nextId++
    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => stop(new EngineTransportError(`Engine worker request timed out after ${timeoutMs} ms`)), timeoutMs)
      pending.set(id, {resolve, reject, timer})
      try {
        worker.postMessage({type, id, bytes: input}, [input.buffer])
      } catch (cause) {
        stop(new EngineTransportError('Cannot send engine worker request', {cause}))
      }
    })
  }
  const semantic = engine(
    async request => {
      const bytes = await send('request', encode(request))
      try {
        return decodeResponse(bytes)
      } catch (cause) {
        const error = new EngineTransportError('Engine worker returned an invalid response', {cause})
        stop(error)
        throw error
      }
    },
    async () => ({digest, call: input => send('compare', input)}),
  )
  return {...semantic, dispose: () => stop(new EngineTransportError('Engine worker disposed'))}
}
