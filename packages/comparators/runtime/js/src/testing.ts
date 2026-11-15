/**
 * Comparator execution FOR TESTS ONLY: in-thread, with no deadline, so a
 * non-terminating module hangs the caller, and in a Worker with a module of
 * the test's own, to exercise the sandbox's bounds. Hosts run only the rules
 * interpreter, through `createRulesRuntime`.
 */
import {decodeOutput} from './abi.js'
import {executeBytes} from './execute.js'
import {prepare, settings, type RunComparatorOptions} from './host.js'
import {nodeRulesInterpreter} from './node.js'
import {run} from './node-worker.js'
import {checkedRules, compareRequest, inspectRequest, type CheckedRules} from './rules.js'
import {decodeObject} from './abi.js'

export {ComparatorRuntimeError, decodeOutput, limits} from './abi.js'
export {encodeInput} from './input.js'
export {inspectModule} from './module-check/inspect.js'

/** For tests only: runs on the calling thread and returns the raw output bytes after checking them. */
export async function runComparatorBytesInThreadForTests(
  moduleBytes: Uint8Array,
  input: unknown,
  options: Omit<RunComparatorOptions, 'deadlineMs'> = {},
): Promise<Uint8Array> {
  const output = executeBytes(await prepare(moduleBytes, input, settings(options)))
  decodeOutput(output)
  return output
}

/** For tests only: runs on the calling thread and returns the parsed comparison. */
export async function runComparatorInThreadForTests(
  moduleBytes: Uint8Array,
  input: unknown,
  options: Omit<RunComparatorOptions, 'deadlineMs'> = {},
): Promise<unknown> {
  return decodeOutput(executeBytes(await prepare(moduleBytes, input, settings(options))))
}

/** For tests only: checks a rules file on the calling thread. */
export async function checkRulesInThreadForTests(rules: Uint8Array): Promise<CheckedRules> {
  const interpreter = await nodeRulesInterpreter()
  return checkedRules(interpreter, decodeObject(executeBytes(inspectRequest(interpreter, rules, 4096, 32 * 1024 * 1024))))
}

/** For tests only: runs a rules comparator on the calling thread and returns the parsed comparison. */
export async function runRulesInThreadForTests(rules: Uint8Array, input: unknown): Promise<unknown> {
  const interpreter = await nodeRulesInterpreter()
  return decodeOutput(executeBytes(compareRequest(interpreter, rules, input, 32 * 1024 * 1024, 4096, 32 * 1024 * 1024)))
}

/** For tests only: runs a module speaking the comparator ABI in a `worker_threads` Worker, with the sandbox's bounds. */
export async function runModuleInWorkerForTests(
  moduleBytes: Uint8Array,
  input: unknown,
  options: RunComparatorOptions = {},
): Promise<unknown> {
  const resolved = settings(options)
  return run(await prepare(moduleBytes, input, resolved), resolved.deadlineMs)
}
