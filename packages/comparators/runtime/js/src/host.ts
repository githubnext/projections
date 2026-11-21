import {ComparatorRuntimeError, PAGE_BYTES, cancelled, errors, limits} from './abi.js'
import {encodeInput} from './input.js'
import {inspectModule} from './module-check/inspect.js'
import type {ExecuteRequest, ExecuteResult} from './execute.js'

/**
 * Bounds on each check or comparison a rules runtime runs; omitted ones take their `limits` defaults. Each must be an
 * integer from 1 up to its maximum (`limits.maxDeadlineMs`, `limits.maxMemoryPages`, 2^31 − 1 input bytes, 2^32 − 1
 * output bytes), or creating the runtime throws `RangeError`.
 */
export interface RunComparatorOptions {
  /** Wall-clock deadline in milliseconds; the Worker is terminated when it passes. Default 30000. */
  deadlineMs?: number
  /** Memory cap in 64 KiB pages. Default 4096 (256 MiB). */
  maxMemoryPages?: number
  /** Input size cap in bytes. Default 32 MiB. */
  maxInputBytes?: number
  /** Output size cap in bytes. Default 32 MiB. */
  maxOutputBytes?: number
}

export interface Settings {
  deadlineMs: number
  maxMemoryPages: number
  maxInputBytes: number
  maxOutputBytes: number
}

const integer = (name: string, value: number | undefined, fallback: number, maximum: number): number => {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) {
    throw new RangeError(`${name} must be an integer between 1 and ${maximum}`)
  }
  return result
}

export function settings(options: RunComparatorOptions = {}): Settings {
  return {
    deadlineMs: integer('deadlineMs', options.deadlineMs, limits.deadlineMs, limits.maxDeadlineMs),
    maxMemoryPages: integer('maxMemoryPages', options.maxMemoryPages, limits.memoryPages, limits.maxMemoryPages),
    maxInputBytes: integer('maxInputBytes', options.maxInputBytes, limits.inputBytes, 0x7fff_ffff),
    maxOutputBytes: integer('maxOutputBytes', options.maxOutputBytes, limits.outputBytes, 0xffff_ffff),
  }
}

/**
 * Compiles and validates a module speaking the comparator ABI, then encodes
 * the input. Rejects malformed modules, any import and missing or mistyped
 * exports before any of its code runs. Hosts run only the rules interpreter;
 * tests use this to exercise the sandbox with modules of their own.
 */
export async function prepare(moduleBytes: Uint8Array, input: unknown, settings: Settings): Promise<ExecuteRequest> {
  if (!(moduleBytes instanceof Uint8Array)) throw new TypeError('moduleBytes must be a Uint8Array')
  let module: WebAssembly.Module
  try {
    module = await WebAssembly.compile(moduleBytes as Uint8Array<ArrayBuffer>)
  } catch (error) {
    return errors.invalidModule(error instanceof Error ? error.message : String(error))
  }
  const memory = inspectModule(moduleBytes)
  // Defense in depth: the engine's own view of the imports must agree.
  if (WebAssembly.Module.imports(module).length > 0) {
    throw new ComparatorRuntimeError('forbidden-import', 'comparator modules must have zero imports')
  }
  const encoded = encodeInput(input, settings.maxInputBytes)
  if (memory.minimumPages > settings.maxMemoryPages) errors.memoryLimit(settings.maxMemoryPages * PAGE_BYTES)
  return {
    module,
    input: encoded,
    maxMemoryPages: settings.maxMemoryPages,
    maxOutputBytes: settings.maxOutputBytes,
  }
}

/** A dedicated, single-use worker running `execute` for one request. */
export interface WorkerHandle {
  post(request: ExecuteRequest): void
  terminate(): void
}

export interface WorkerEvents {
  message(data: unknown): void
  error(message: string): void
}

/** Runs one request in a fresh worker, terminating it on completion, failure or deadline. */
export function runInWorker(
  spawn: (events: WorkerEvents) => WorkerHandle,
  request: ExecuteRequest,
  deadlineMs: number,
  signal?: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled(signal))
    let settled = false
    let worker: WorkerHandle | undefined
    const abort = () => finish(cancelled(signal!))
    const finish = (error: ComparatorRuntimeError | undefined, value?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      worker?.terminate()
      if (error) reject(error)
      else resolve(value)
    }
    const timer = setTimeout(
      () => finish(new ComparatorRuntimeError('deadline', `comparator exceeded its ${deadlineMs} ms deadline`)),
      deadlineMs,
    )
    signal?.addEventListener('abort', abort, {once: true})
    try {
      worker = spawn({
        message(data) {
          const result = data as ExecuteResult | null
          if (result?.ok === true) finish(undefined, result.value)
          else if (result?.ok === false && typeof result.code === 'string' && typeof result.message === 'string') {
            finish(new ComparatorRuntimeError(result.code, result.message))
          } else {
            finish(new ComparatorRuntimeError('worker', 'comparator worker returned an invalid message'))
          }
        },
        error(message) {
          finish(new ComparatorRuntimeError('worker', `comparator worker failed: ${message}`))
        },
      })
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- the worker's callbacks can settle it as it starts
      if (settled) worker.terminate()
      else worker.post(request)
    } catch (error) {
      finish(
        new ComparatorRuntimeError(
          'worker',
          `comparator worker failed to start: ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
    }
  })
}
