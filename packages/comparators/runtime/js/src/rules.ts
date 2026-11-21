/**
 * Custom comparators: a YAML comparator file (`<name>.comparator.yaml`) run by
 * the rules interpreter (`rules.wasm`), itself an ordinary zero-import
 * comparator module run in the same sandbox as any other. Comparator files are
 * data; the interpreter is checked and compiled once per host, and each
 * comparator file is checked once per content.
 * Portable: no Node or DOM-only APIs.
 */
import {ComparatorRuntimeError, RULES_INSPECT_EXPORT, abortable, cancelled, errors, limits} from './abi.js'
import {encodeInput} from './input.js'
import {inspectModule} from './module-check/inspect.js'
import type {ExecuteRequest} from './execute.js'

/** Whether a path names a comparator file: `<name>.comparator.yaml` or `<name>.comparator.yml`. */
export function isComparatorFile(path: string): boolean {
  return path.endsWith('.comparator.yaml') || path.endsWith('.comparator.yml')
}

/** The custom section in which the rules interpreter's build records the digest of its source. */
export const INTERPRETER_SECTION = 'projections.interpreter'

/** The rules interpreter, compiled, and its identity: the source digest its build embeds, or else the digest of its bytes. */
export interface RulesInterpreter {
  module: WebAssembly.Module
  digest: string
}

/** A rules file that passed the interpreter's checks. */
export interface CheckedRules {
  /** `sha256:<hex>` over a fixed tag, the interpreter's digest and the canonical rules, matching the Rust runtime. */
  digest: string
  /** RFC 8785 JSON of the parsed rules; comments and layout do not change it. */
  canonical: string
  /** Lint warnings: the rules load and run, but should change (for example, a chain of conditionals that reads better as `match`). */
  warnings: RulesDiagnostic[]
}

/** One problem the rules check found, with a JSON pointer and, in `message`, the YAML line and column. */
export interface RulesDiagnostic {
  code: string
  path: string
  message: string
}

/** The rules file failed its load-time checks. */
export class RulesError extends ComparatorRuntimeError {
  constructor(readonly diagnostics: RulesDiagnostic[]) {
    super(
      'invalid-module',
      `invalid rules file:\n${diagnostics.map(item => `${item.code} at ${item.path || '/'}: ${item.message}`).join('\n')}`,
    )
  }
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('')

async function sha256(bytes: Uint8Array): Promise<string> {
  return `sha256:${hex(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))}`
}

/** A rules comparator's identity, as `projections-comparator-runtime`'s `rules_digest`. */
export async function rulesComparatorDigest(interpreterDigest: string, canonical: string): Promise<string> {
  return sha256(new TextEncoder().encode(`projections-rules-comparator\n${interpreterDigest}\n${canonical}`))
}

const interpreters = new Map<string, Promise<RulesInterpreter>>()

/** Loads, checks and compiles the rules interpreter once per key. */
export function loadRulesInterpreter(key: string, load: () => Promise<Uint8Array>): Promise<RulesInterpreter> {
  let interpreter = interpreters.get(key)
  if (!interpreter) {
    interpreter = (async () => {
      let bytes: Uint8Array
      try {
        bytes = await load()
      } catch (error) {
        throw new ComparatorRuntimeError(
          'invalid-module',
          `invalid comparator module: the rules interpreter could not be loaded: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      let module: WebAssembly.Module
      try {
        module = await WebAssembly.compile(bytes as Uint8Array<ArrayBuffer>)
      } catch (error) {
        return errors.invalidModule(error instanceof Error ? error.message : String(error))
      }
      inspectModule(bytes)
      if (WebAssembly.Module.imports(module).length > 0) {
        throw new ComparatorRuntimeError('forbidden-import', 'comparator modules must have zero imports')
      }
      if (!WebAssembly.Module.exports(module).some(entry => entry.name === RULES_INSPECT_EXPORT && entry.kind === 'function')) {
        throw new ComparatorRuntimeError('missing-export', `the rules interpreter must export ${RULES_INSPECT_EXPORT}`)
      }
      // The interpreter's identity is the source digest its build embeds; builds on different hosts differ in bytes.
      const [section] = WebAssembly.Module.customSections(module, INTERPRETER_SECTION)
      const embedded = section ? new TextDecoder().decode(section) : ''
      return {module, digest: /^sha256:[0-9a-f]{64}$/.test(embedded) ? embedded : await sha256(bytes)}
    })()
    interpreter.catch(() => interpreters.delete(key))
    interpreters.set(key, interpreter)
  }
  return interpreter
}

function rulesText(rules: Uint8Array): void {
  if (!(rules instanceof Uint8Array)) throw new TypeError('rules must be a Uint8Array')
  if (rules.length > limits.inputBytes) errors.invalidModule(`a rules file is limited to ${limits.inputBytes} bytes`)
  try {
    new TextDecoder('utf-8', {fatal: true}).decode(rules)
  } catch {
    errors.invalidModule('a rules file must be UTF-8')
  }
}

/** The request that runs the interpreter's check on a rules file. */
export function inspectRequest(
  interpreter: RulesInterpreter,
  rules: Uint8Array,
  maxMemoryPages: number,
  maxOutputBytes: number,
): ExecuteRequest {
  rulesText(rules)
  return {module: interpreter.module, input: new Uint8Array(rules), entry: RULES_INSPECT_EXPORT, maxMemoryPages, maxOutputBytes}
}

/** The request that compares two extractions with a rules file; the interpreter computes the default baseline itself. */
export function compareRequest(
  interpreter: RulesInterpreter,
  rules: Uint8Array,
  input: unknown,
  maxInputBytes: number,
  maxMemoryPages: number,
  maxOutputBytes: number,
): ExecuteRequest {
  rulesText(rules)
  const envelope = input as {options?: unknown} | null
  const options = envelope && typeof envelope === 'object' ? (envelope.options ?? {}) : {}
  const wrapped =
    envelope && typeof envelope === 'object' ? {...envelope, options: {rules: new TextDecoder().decode(rules), options}} : envelope
  return {module: interpreter.module, input: encodeInput(wrapped, maxInputBytes), maxMemoryPages, maxOutputBytes}
}

/** Reads the interpreter's check: the checked rules' digest, or a `RulesError`. */
export async function checkedRules(interpreter: RulesInterpreter, report: unknown): Promise<CheckedRules> {
  const value = report as {canonical?: unknown; diagnostics?: unknown; warnings?: unknown}
  if (typeof value?.canonical === 'string') {
    return {
      canonical: value.canonical,
      digest: await rulesComparatorDigest(interpreter.digest, value.canonical),
      warnings: Array.isArray(value.warnings) ? value.warnings.map(diagnostic) : [],
    }
  }
  if (Array.isArray(value?.diagnostics)) {
    throw new RulesError(value.diagnostics.map(diagnostic))
  }
  return errors.invalidOutput('the rules check returned neither canonical rules nor diagnostics')
}

/** One diagnostic from the interpreter's report. */
export function diagnostic(value: unknown): RulesDiagnostic {
  const item = value as {code?: unknown; path?: unknown; message?: unknown} | null
  return {code: text(item?.code, 'invalid-rules'), path: text(item?.path, ''), message: text(item?.message, '')}
}

function text(value: unknown, missing: string) {
  if (value === undefined || value === null) return missing
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/**
 * Runs rules comparators in a host's sandbox. `check` runs the interpreter's
 * load-time checks and returns the comparator digest, cached per rules
 * content; `compare` runs one comparison.
 */
/**
 * Per call: `signal` cancels the check or comparison, which then stops its Worker or runner process and rejects with
 * `cancelled`, so a caller with an overall deadline (`AbortSignal.timeout`) never leaves one running past it.
 */
export interface RulesCallOptions {
  signal?: AbortSignal
}

/** Checks and runs comparator files sandboxed, each call in its own Worker or runner process; see `RulesCallOptions`. */
export interface RulesRuntime {
  check(rules: Uint8Array, options?: RulesCallOptions): Promise<CheckedRules>
  compare(rules: Uint8Array, input: unknown, options?: RulesCallOptions): Promise<unknown>
}

/**
 * Caches `check` per rules content, so a host checks each rules file once. A check that succeeded is shared by every
 * caller; one still running is shared only by callers without a signal. A caller with a signal runs its own check,
 * which its signal alone can cancel, and shares the result once it succeeds, so cancelling one caller never fails
 * another. An aborted signal is rejected before anything is looked up or run.
 */
export function cachedChecks(
  check: (rules: Uint8Array, options?: RulesCallOptions) => Promise<CheckedRules>,
  capacity = 64,
): (rules: Uint8Array, options?: RulesCallOptions) => Promise<CheckedRules> {
  const cache = new Map<string, Promise<CheckedRules>>()
  const succeeded = new WeakSet<Promise<CheckedRules>>()
  const remember = (key: string, checked: Promise<CheckedRules>) => {
    cache.delete(key)
    cache.set(key, checked)
    while (cache.size > capacity) cache.delete(cache.keys().next().value!)
  }
  return async (rules, options) => {
    const signal = options?.signal
    if (signal?.aborted) throw cancelled(signal)
    const key = await sha256(rules)
    const cached = cache.get(key)
    if (cached && (!signal || succeeded.has(cached))) {
      remember(key, cached)
      return abortable(cached, signal)
    }
    const checked = check(rules, signal ? {signal} : {})
    if (!signal) remember(key, checked)
    checked.then(
      () => {
        succeeded.add(checked)
        if (signal && !cache.has(key)) remember(key, checked)
      },
      () => {
        if (cache.get(key) === checked) cache.delete(key)
      },
    )
    return checked
  }
}
