/**
 * The comparator module ABI shared by every host, and the checks the Rust
 * runtime (`projections-comparator-runtime`) applies, with the same error codes
 * and messages. Portable: no Node or DOM-only APIs.
 *
 * The comparator Worker loads this module with `execute.js` and
 * `worker-entry.js` only, so it imports nothing; the main-thread checks of a
 * module's bytes (`module-check/`) and of the input (`input.ts`) live apart.
 */

export const PROTOCOL_VERSION = 0
export const MEMORY_EXPORT = 'memory'
export const ALLOC_EXPORT = 'projections_alloc'
export const COMPARE_EXPORT = 'projections_compare'
/** The rules interpreter's check: `(rules, rulesLength) -> packed {"canonical"} or {"diagnostics"}`. */
export const RULES_INSPECT_EXPORT = 'projections_rules_inspect'
export const PAGE_BYTES = 65_536

/**
 * The sandbox's default bounds for one check or comparison and the largest values its options accept; a run that
 * exceeds a bound fails with the matching `ComparatorErrorCode` rather than being cut short silently.
 */
export const limits = Object.freeze({
  /** Default wall-clock deadline for one run. */
  deadlineMs: 30_000,
  /** The longest deadline an option may set: 10 minutes. */
  maxDeadlineMs: 600_000,
  /** Default memory cap: 4096 pages, 256 MiB. */
  memoryPages: 4096,
  /** The largest memory cap an option may set: 65536 pages, the whole 4 GiB of 32-bit memory. */
  maxMemoryPages: 65_536,
  /** Default cap on the encoded input, in bytes: 32 MiB. */
  inputBytes: 32 * 1024 * 1024,
  /** Default cap on the comparator's output, in bytes: 32 MiB. */
  outputBytes: 32 * 1024 * 1024,
})

/**
 * Why a comparator run failed, the same codes the Rust runtime reports: the module was rejected before running
 * (`invalid-module`, `forbidden-import`, `missing-export`, `invalid-export`), the input was (`invalid-input`,
 * `input-too-large`), it hit a bound (`out-of-fuel` and `table-limit` in the native runner, `deadline`,
 * `memory-limit`), it trapped (`trap`), its result was malformed (`invalid-return`, `output-too-large`,
 * `invalid-output`), it returned `{"error": message}` (`comparator-error`), its Worker or runner process failed
 * (`worker`), or the caller's signal cancelled it (`cancelled`, the run stopped).
 */
export type ComparatorErrorCode =
  | 'invalid-module'
  | 'forbidden-import'
  | 'missing-export'
  | 'invalid-export'
  | 'invalid-input'
  | 'input-too-large'
  | 'out-of-fuel'
  | 'deadline'
  | 'memory-limit'
  | 'table-limit'
  | 'trap'
  | 'invalid-return'
  | 'output-too-large'
  | 'invalid-output'
  | 'comparator-error'
  | 'worker'
  | 'cancelled'

/** A comparator module could not be loaded or run. Never falls back to another comparison. */
export class ComparatorRuntimeError extends Error {
  override name = 'ComparatorRuntimeError'
  readonly code: ComparatorErrorCode

  constructor(code: ComparatorErrorCode, message: string) {
    super(message)
    this.code = code
  }
}

/** The error for a run its caller's signal cancelled. */
export function cancelled(signal: AbortSignal): ComparatorRuntimeError {
  const reason = signal.reason instanceof Error ? `: ${signal.reason.message}` : ''
  return new ComparatorRuntimeError('cancelled', `the comparator run was cancelled${reason}`)
}

/**
 * `promise`, or a rejection with `cancelled` as soon as `signal` aborts: this caller stops waiting, and the work
 * `promise` stands for, which other callers may share, carries on.
 */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(cancelled(signal))
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(cancelled(signal))
    signal.addEventListener('abort', abort, {once: true})
    promise.then(
      value => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}

export const fail = (code: ComparatorErrorCode, message: string): never => {
  throw new ComparatorRuntimeError(code, message)
}

export const errors = {
  invalidModule: (detail: string) => fail('invalid-module', `invalid comparator module: ${detail}`),
  invalidInput: (detail: string) => fail('invalid-input', `invalid comparator input: ${detail}`),
  invalidOutput: (detail: string) => fail('invalid-output', `invalid comparator output: ${detail}`),
  invalidReturn: (detail: string) => fail('invalid-return', `comparator returned an invalid value: ${detail}`),
  memoryLimit: (limitBytes: number) => fail('memory-limit', `comparator tried to grow its memory beyond the ${limitBytes}-byte limit`),
  inputTooLarge: (size: number, limit: number) =>
    fail('input-too-large', `comparator input is ${size} bytes, exceeding the ${limit}-byte limit`),
  outputTooLarge: (size: number, limit: number) =>
    fail('output-too-large', `comparator output is ${size} bytes, exceeding the ${limit}-byte limit`),
}

export interface ModuleInfo {
  /** Initial pages of the exported memory. */
  minimumPages: number
  /** Declared maximum pages of the exported memory, if any. */
  maximumPages?: number
}

export const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export const checkFields = (object: Record<string, unknown>, allowed: readonly string[], what: string): string | undefined => {
  // Sorted, so the first unknown field matches the Rust runtime's report.
  const unknown = Object.keys(object)
    .toSorted()
    .find(key => !allowed.includes(key))
  return unknown === undefined ? undefined : `${what} has unknown field \`${unknown}\``
}

const comparisonFields = ['protocolVersion', 'changes', 'steps', 'order', 'reverseSteps', 'variation', 'metadata'] as const

/** Decodes UTF-8 JSON output that must be an object. */
export function decodeObject(bytes: Uint8Array): Record<string, unknown> {
  let text: string
  try {
    text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(bytes)
  } catch (error) {
    return errors.invalidOutput(`output is not UTF-8: ${error instanceof Error ? error.message : String(error)}`)
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    return errors.invalidOutput(`output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isObject(value)) return errors.invalidOutput('output must be a JSON object')
  return value
}

/**
 * Decodes comparator output: returns the comparison, or throws for
 * `{"error": message}` (`comparator-error`) and for anything malformed.
 */
export function decodeOutput(bytes: Uint8Array): unknown {
  const value = decodeObject(bytes)
  if (Object.hasOwn(value, 'error')) {
    if (typeof value.error === 'string' && Object.keys(value).length === 1) {
      fail('comparator-error', `comparator failed: ${value.error}`)
    }
    errors.invalidOutput('an error result must be exactly {"error": "message"}')
  }
  const unknown = checkFields(value, comparisonFields, 'comparison')
  if (unknown) errors.invalidOutput(unknown)
  if (value.protocolVersion !== PROTOCOL_VERSION) errors.invalidOutput(`comparison must have protocolVersion ${PROTOCOL_VERSION}`)
  for (const [field, required, array] of [
    ['changes', true, true],
    ['steps', true, true],
    ['reverseSteps', false, true],
    ['order', false, false],
    ['variation', false, false],
    ['metadata', false, false],
  ] as const) {
    const member = value[field]
    if (member === undefined && !required) continue
    if (array ? !Array.isArray(member) : !isObject(member)) {
      errors.invalidOutput(`comparison field \`${field}\` must be ${array ? 'an array' : 'an object'}`)
    }
  }
  return value
}
