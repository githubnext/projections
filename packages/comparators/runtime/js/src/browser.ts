import {run} from './browser-worker.js'
import {settings, type RunComparatorOptions} from './host.js'
import {cachedChecks, checkedRules, compareRequest, inspectRequest, loadRulesInterpreter, type RulesRuntime} from './rules.js'

export {ComparatorRuntimeError, limits, type ComparatorErrorCode} from './abi.js'
export type {RunComparatorOptions} from './host.js'
export {RulesError, isComparatorFile, rulesComparatorDigest, type CheckedRules, type RulesDiagnostic, type RulesRuntime} from './rules.js'

/** The sandbox bounds for `createRulesRuntime` in a browser, and where its Worker script and interpreter are served. */
export interface BrowserComparatorOptions extends RunComparatorOptions {
  /** URL of the worker script; defaults to the packaged `worker-entry.js`. */
  workerUrl?: URL | string
  /**
   * URL of the rules interpreter; defaults to the packaged `rules.wasm`. It is
   * fetched and compiled once.
   */
  rulesInterpreterUrl?: URL | string
}

// Not a literal `new URL('./…', import.meta.url)`, so bundlers don't copy the interpreter a second time.
const rulesFile = 'rules.wasm'

/**
 * Rules comparators in dedicated Web Workers: each check and comparison runs
 * the rules interpreter in a fresh worker that is terminated at the deadline,
 * with bounded memory.
 */
export function createRulesRuntime(options: BrowserComparatorOptions = {}): RulesRuntime {
  const resolved = settings(options)
  const url = new URL(String(options.rulesInterpreterUrl ?? new URL(rulesFile, import.meta.url)), globalThis.location?.href)
  const interpreter = () =>
    loadRulesInterpreter(url.href, async () => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`${url.href} returned ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    })
  return {
    check: cachedChecks(async rules => {
      const loaded = await interpreter()
      const report = await run(
        inspectRequest(loaded, rules, resolved.maxMemoryPages, resolved.maxOutputBytes),
        resolved.deadlineMs,
        options.workerUrl,
      )
      return checkedRules(loaded, report)
    }),
    async compare(rules, input) {
      const loaded = await interpreter()
      const request = compareRequest(loaded, rules, input, resolved.maxInputBytes, resolved.maxMemoryPages, resolved.maxOutputBytes)
      return run(request, resolved.deadlineMs, options.workerUrl)
    },
  }
}
