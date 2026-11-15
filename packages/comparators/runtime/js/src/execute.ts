import {ALLOC_EXPORT, COMPARE_EXPORT, ComparatorRuntimeError, MEMORY_EXPORT, PAGE_BYTES, decodeObject, decodeOutput, errors} from './abi.js'

export interface ExecuteRequest {
  /** The module: the rules interpreter, or a test's module speaking its ABI. */
  module: WebAssembly.Module
  input: Uint8Array
  maxMemoryPages: number
  maxOutputBytes: number
  /** The export to call instead of `projections_compare`, whose output is any JSON object. */
  entry?: string
}

export type ExecuteResult = {ok: true; value: unknown} | {ok: false; code: ComparatorRuntimeError['code']; message: string}

/**
 * Instantiates the module with no imports and runs one comparison on the
 * calling thread, returning the raw output bytes. Not bounded in time: hosts
 * call it inside a Worker they terminate at the deadline.
 */
export function executeBytes(request: ExecuteRequest): Uint8Array {
  const limitBytes = request.maxMemoryPages * PAGE_BYTES
  let memory: WebAssembly.Memory | undefined
  // Memory never shrinks, so checking its size afterward catches any growth beyond the cap.
  const checkMemory = () => {
    if (memory && memory.buffer.byteLength > limitBytes) errors.memoryLimit(limitBytes)
  }
  try {
    const instance = new WebAssembly.Instance(request.module, {})
    const exports = instance.exports
    memory = exports[MEMORY_EXPORT] as WebAssembly.Memory
    const alloc = exports[ALLOC_EXPORT] as (length: number) => number
    checkMemory()
    const write = (bytes: Uint8Array): [number, number] => {
      const length = bytes.length
      const pointer = alloc(length)
      checkMemory()
      const start = pointer >>> 0
      if (start + length > memory!.buffer.byteLength) {
        errors.invalidReturn(
          `${ALLOC_EXPORT}(${length}) returned ${start}, which does not address ${length} bytes of its ${memory!.buffer.byteLength}-byte memory`,
        )
      }
      new Uint8Array(memory!.buffer, start, length).set(bytes)
      return [pointer, length]
    }
    const compare = exports[request.entry ?? COMPARE_EXPORT] as (pointer: number, length: number) => bigint
    const packed = BigInt.asUintN(64, compare(...write(request.input)))
    checkMemory()
    const outputStart = Number(packed >> 32n)
    const outputLength = Number(packed & 0xffff_ffffn)
    if (outputLength > request.maxOutputBytes) errors.outputTooLarge(outputLength, request.maxOutputBytes)
    if (outputStart + outputLength > memory.buffer.byteLength) {
      errors.invalidReturn(
        `${COMPARE_EXPORT} returned ${outputLength} bytes at ${outputStart}, outside its ${memory.buffer.byteLength}-byte memory`,
      )
    }
    return new Uint8Array(memory.buffer, outputStart, outputLength).slice()
  } catch (error) {
    checkMemory()
    if (error instanceof ComparatorRuntimeError) throw error
    throw new ComparatorRuntimeError('trap', `comparator trapped: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Runs [`executeBytes`] and decodes the output into a structured-cloneable result. */
export function execute(request: ExecuteRequest): ExecuteResult {
  try {
    const output = executeBytes(request)
    return {ok: true, value: request.entry ? decodeObject(output) : decodeOutput(output)}
  } catch (error) {
    if (error instanceof ComparatorRuntimeError) return {ok: false, code: error.code, message: error.message}
    return {ok: false, code: 'worker', message: error instanceof Error ? error.message : String(error)}
  }
}
