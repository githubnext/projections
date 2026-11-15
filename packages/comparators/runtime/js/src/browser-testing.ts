/**
 * The Web Worker sandbox with a module of the test's own, FOR TESTS ONLY: the
 * browser tests exercise deadlines, imports and memory bounds with tiny
 * hand-built modules speaking the rules interpreter's ABI. Not exported by the
 * package; hosts run only the rules interpreter.
 */
import {run} from './browser-worker.js'
import {prepare, settings, type RunComparatorOptions} from './host.js'

export async function runModuleInWorkerForTests(
  moduleBytes: Uint8Array,
  input: unknown,
  options: RunComparatorOptions = {},
): Promise<unknown> {
  const resolved = settings(options)
  return run(await prepare(moduleBytes, input, resolved), resolved.deadlineMs, undefined)
}
