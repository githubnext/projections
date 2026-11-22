import {spawn} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {settings, type RunComparatorOptions} from './host.js'
import {run} from './node-worker.js'
import {cachedChecks, checkedRules, diagnostic, compareRequest, inspectRequest, loadRulesInterpreter, type RulesRuntime} from './rules.js'
import {ComparatorRuntimeError, abortable, cancelled, limits} from './abi.js'

const noop = () => undefined

export {ComparatorRuntimeError, limits, type ComparatorErrorCode} from './abi.js'
export type {RunComparatorOptions} from './host.js'
export {
  RulesError,
  isComparatorFile,
  rulesComparatorDigest,
  type CheckedRules,
  type RulesCallOptions,
  type RulesDiagnostic,
  type RulesRuntime,
} from './rules.js'

const rulesUrl = new URL('./rules.wasm', import.meta.url)
/** The packaged rules interpreter, checked and compiled once. */
export const nodeRulesInterpreter = () => loadRulesInterpreter(rulesUrl.href, async () => new Uint8Array(await readFile(rulesUrl)))

/**
 * Rules comparators in `worker_threads` Workers: each check and comparison
 * runs the rules interpreter in a fresh worker that is terminated at the
 * deadline, with bounded memory.
 */
export function createRulesRuntime(options: RunComparatorOptions = {}): RulesRuntime {
  const resolved = settings(options)
  return {
    check: cachedChecks(async (rules, call) => {
      const interpreter = await abortable(nodeRulesInterpreter(), call?.signal)
      const report = await run(
        inspectRequest(interpreter, rules, resolved.maxMemoryPages, resolved.maxOutputBytes),
        resolved.deadlineMs,
        call?.signal,
      )
      return checkedRules(interpreter, report)
    }),
    async compare(rules, input, call) {
      const interpreter = await abortable(nodeRulesInterpreter(), call?.signal)
      const request = compareRequest(interpreter, rules, input, resolved.maxInputBytes, resolved.maxMemoryPages, resolved.maxOutputBytes)
      return run(request, resolved.deadlineMs, call?.signal)
    },
  }
}

/**
 * Where `createNativeRulesRuntime` finds its runner and interpreter, and its deadline. Fuel and memory are the
 * runner's own fixed bounds, the CLI's, so they are not options here.
 */
export interface NativeRulesRuntimeOptions {
  /** The `projections-rules` executable; defaults to the packaged one for this platform. */
  executable?: string
  /** The rules interpreter it runs; defaults to the packaged `rules.wasm`. */
  interpreter?: string
  /** Wall-clock deadline per check or comparison, in milliseconds. Default 30000. */
  deadlineMs?: number
}

/**
 * Rules comparators run natively in wasmi, by the packaged `projections-rules`
 * executable, under the same fuel and memory limits as the CLI: one process
 * per check or comparison, killed at the deadline. For servers, such as a
 * hosted view's verifier, where the bounds must not depend on a browser.
 */
export function createNativeRulesRuntime(options: NativeRulesRuntimeOptions = {}): RulesRuntime {
  const deadlineMs = options.deadlineMs ?? limits.deadlineMs
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > limits.maxDeadlineMs) {
    throw new RangeError(`deadlineMs must be an integer between 1 and ${limits.maxDeadlineMs}`)
  }
  const interpreter = options.interpreter ?? fileURLToPath(new URL('./rules.wasm', import.meta.url))
  const executable = options.executable ?? packagedRunner()
  const call = (request: unknown, signal?: AbortSignal) => runNative(executable, interpreter, request, deadlineMs, signal)
  return {
    check: cachedChecks(async (rules, checkOptions) => {
      const result = (await call({operation: 'check', rules: rulesSource(rules)}, checkOptions?.signal)) as {
        digest?: unknown
        canonical?: unknown
        warnings?: unknown
      } | null
      if (typeof result?.digest !== 'string' || typeof result.canonical !== 'string') {
        throw new ComparatorRuntimeError('invalid-output', 'the rules runner returned an invalid check')
      }
      return {
        digest: result.digest,
        canonical: result.canonical,
        warnings: Array.isArray(result.warnings) ? result.warnings.map(diagnostic) : [],
      }
    }),
    compare: (rules, input, compareOptions) => call({operation: 'compare', rules: rulesSource(rules), input}, compareOptions?.signal),
  }
}

function rulesSource(rules: Uint8Array): string {
  if (!(rules instanceof Uint8Array)) throw new TypeError('rules must be a Uint8Array')
  if (rules.length > limits.inputBytes) {
    throw new ComparatorRuntimeError('invalid-module', `a rules file is limited to ${limits.inputBytes} bytes`)
  }
  try {
    return new TextDecoder('utf-8', {fatal: true}).decode(rules)
  } catch {
    throw new ComparatorRuntimeError('invalid-module', 'a rules file must be UTF-8')
  }
}

function packagedRunner(): string {
  const platform: unknown = JSON.parse(readFileSync(new URL('./native/platform.json', import.meta.url), 'utf8'))
  if (
    platform === null ||
    typeof platform !== 'object' ||
    !('platform' in platform) ||
    platform.platform !== process.platform ||
    !('arch' in platform) ||
    platform.arch !== process.arch
  ) {
    throw new ComparatorRuntimeError('worker', 'the packaged rules runner does not match this platform; build locally or set executable')
  }
  return fileURLToPath(new URL(`./native/projections-rules${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url))
}

const codes = new Set<string>([
  'invalid-module',
  'forbidden-import',
  'missing-export',
  'invalid-export',
  'invalid-input',
  'input-too-large',
  'out-of-fuel',
  'deadline',
  'memory-limit',
  'table-limit',
  'trap',
  'invalid-return',
  'output-too-large',
  'invalid-output',
  'comparator-error',
])

function runNative(executable: string, interpreter: string, request: unknown, deadlineMs: number, signal?: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelled(signal))
      return
    }
    const child = spawn(executable, ['--interpreter', interpreter], {stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true})
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const abort = () => finish(cancelled(signal!))
    const timer = setTimeout(
      () => finish(new ComparatorRuntimeError('deadline', `the rules runner exceeded its ${deadlineMs} ms deadline`)),
      deadlineMs,
    )
    function finish(error: ComparatorRuntimeError | undefined, value?: unknown) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (error) {
        child.kill('SIGKILL')
        reject(error)
      } else resolve(value)
    }
    signal?.addEventListener('abort', abort, {once: true})
    child.on('error', error => finish(new ComparatorRuntimeError('worker', `the rules runner failed to start: ${error.message}`)))
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limits.outputBytes + 1024) finish(new ComparatorRuntimeError('output-too-large', 'the rules runner output is too large'))
      else chunks.push(chunk)
    })
    child.stderr.resume()
    child.on('close', () => {
      if (settled) return
      let response: {ok?: unknown; result?: unknown; error?: {code?: unknown; message?: unknown}}
      try {
        response = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof response
      } catch {
        finish(new ComparatorRuntimeError('worker', 'the rules runner exited without a response'))
        return
      }
      if (response.ok === true) finish(undefined, response.result)
      else {
        const code = typeof response.error?.code === 'string' && codes.has(response.error.code) ? response.error.code : 'worker'
        const message = typeof response.error?.message === 'string' ? response.error.message : 'the rules runner failed'
        finish(new ComparatorRuntimeError(code as ComparatorRuntimeError['code'], message))
      }
    })
    child.stdin.on('error', noop)
    child.stdin.end(JSON.stringify(request))
  })
}
