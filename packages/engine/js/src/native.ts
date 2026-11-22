import {spawn} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import type {ProjectionEngine} from '@githubnext/projections-schemas'
import {decodeResponse} from './decoding.js'
import {encode} from './encoding.js'
import {engine} from './engine.js'
import {EngineTransportError, limits} from './transport.js'
import {createComparatorTransport} from './comparator-transport.js'

export {EngineError, EngineTransportError, limits} from './transport.js'

/** How `createNativeEngine` runs the engine executable. */
export interface NativeEngineOptions {
  /** Path of the engine executable; defaults to the packaged one, built only for the packaging host's platform. */
  executable?: string
  /** Per-call limit in milliseconds, 1–300000; defaults to 30000. A call that runs longer is killed and rejects. */
  timeoutMs?: number
  /** Ceiling on one response's stdout bytes, from 1 up to `limits.responseBytes` (its default). */
  maxResponseBytes?: number
  /** Default comparator module bytes; defaults to the packaged `artifacts/default-comparator.wasm`. */
  comparator?: {module: BufferSource}
}

/**
 * Creates the engine over its native executable, for Node. Each operation spawns one process with no arguments, writes
 * the request as JSON to its stdin and reads one response from its stdout, so calls share no state. Exit 0 must carry
 * a result and exit 1 diagnostics; any other exit, a signal, more than 64 KiB of stderr, oversized stdout or a timeout
 * rejects with `EngineTransportError`. `compare` runs the default comparator in-process from
 * `artifacts/default-comparator.wasm`, read and compiled on first use.
 *
 * @param options - The executable, per-call timeout, response ceiling and comparator module bytes.
 * @returns The engine; unlike the Wasm and Worker factories it is ready synchronously.
 * @throws `RangeError` when `timeoutMs` or `maxResponseBytes` is out of range, and `EngineTransportError` when no
 *   `executable` is given and the packaged one was built for another platform or architecture.
 *
 * @example
 * ```ts
 * import {createNativeEngine} from '@githubnext/projections-engine/native'
 *
 * const engine = createNativeEngine({timeoutMs: 60_000})
 * const extraction = await engine.decode(rawExtractorJson)
 * const {digest} = await engine.canonicalize(extraction)
 * ```
 */
export function createNativeEngine(options: NativeEngineOptions = {}): ProjectionEngine {
  const timeoutMs = options.timeoutMs ?? 30_000
  const maxResponseBytes = options.maxResponseBytes ?? limits.responseBytes
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
    throw new RangeError('timeoutMs must be between 1 and 300000')
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > limits.responseBytes) {
    throw new RangeError(`maxResponseBytes must be between 1 and ${limits.responseBytes}`)
  }
  let executable = options.executable
  if (executable === undefined) {
    const platform: unknown = JSON.parse(readFileSync(new URL('../artifacts/native/platform.json', import.meta.url), 'utf8'))
    if (
      platform === null ||
      typeof platform !== 'object' ||
      !('platform' in platform) ||
      platform.platform !== process.platform ||
      !('arch' in platform) ||
      platform.arch !== process.arch
    ) {
      throw new EngineTransportError(
        'Packaged native executable does not match this platform/architecture; build locally or set executable',
      )
    }
    executable = fileURLToPath(
      new URL(`../artifacts/native/projections-engine${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url),
    )
  }
  const command = executable
  const comparator = options.comparator
  const defaultComparator = () =>
    createComparatorTransport(
      comparator ?? {
        module: readFileSync(new URL('../artifacts/default-comparator.wasm', import.meta.url)),
      },
    )
  return engine(async request => {
    const input = encode(request)
    return new Promise((resolve, reject) => {
      const child = spawn(command, [], {stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true})
      const chunks: Buffer[] = []
      const errors: Buffer[] = []
      let outputBytes = 0
      let errorBytes = 0
      let failure: EngineTransportError | undefined
      const stop = (error: EngineTransportError): void => {
        failure ??= error
        child.kill('SIGKILL')
      }
      const timer = setTimeout(() => stop(new EngineTransportError(`Native engine timed out after ${timeoutMs} ms`)), timeoutMs)
      child.on('error', cause => {
        failure ??= new EngineTransportError(`Cannot execute native engine: ${cause.message}`, {cause})
      })
      child.stdin.on('error', cause => {
        // EPIPE is classified from the process exit and response, not hidden.
        if (!('code' in cause) || cause.code !== 'EPIPE') {
          stop(new EngineTransportError(`Cannot write engine request: ${cause.message}`, {cause}))
        }
      })
      child.stdout.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length
        if (outputBytes > maxResponseBytes) stop(new EngineTransportError('Native engine stdout exceeded its byte limit'))
        else chunks.push(chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => {
        errorBytes += chunk.length
        if (errorBytes > 64 * 1024) stop(new EngineTransportError('Native engine stderr exceeded 64 KiB'))
        else errors.push(chunk)
      })
      child.on('close', (code, signal) => {
        clearTimeout(timer)
        if (failure) {
          reject(failure)
          return
        }
        if (signal || code === null) {
          reject(new EngineTransportError(`Native engine terminated by ${signal ?? 'unknown signal'}`))
          return
        }
        try {
          const response = decodeResponse(Buffer.concat(chunks))
          if ((response.ok && code !== 0) || (!response.ok && code !== 1)) {
            throw new EngineTransportError(`Native engine exited ${code}: ${Buffer.concat(errors).toString('utf8')}`)
          }
          resolve(response)
        } catch (cause) {
          reject(
            new EngineTransportError(`Native engine response/exit failure (exit ${code}): ${Buffer.concat(errors).toString('utf8')}`, {
              cause,
            }),
          )
        }
      })
      child.stdin.end(input)
    })
  }, defaultComparator)
}
