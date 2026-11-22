import {EngineTransportError, limits} from './transport.js'

/**
 * Where the engine's WebAssembly module comes from: `module`, a compiled `WebAssembly.Module` or its bytes (for offline
 * loading or reuse), or `url` to fetch; with neither, the packaged `artifacts/engine.wasm` beside the package. The two
 * are mutually exclusive.
 */
export type WasmEngineOptions = {module: WebAssembly.Module | BufferSource; url?: never} | {url?: URL | string; module?: never}

interface EngineExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory
  engine_alloc: (length: number) => number
  engine_free: (pointer: number, length: number) => void
  engine_call: (pointer: number, length: number) => bigint
}

function exportsOf(instance: WebAssembly.Instance): EngineExports {
  const exports = instance.exports
  if (
    !(exports.memory instanceof WebAssembly.Memory) ||
    typeof exports.engine_alloc !== 'function' ||
    typeof exports.engine_free !== 'function' ||
    typeof exports.engine_call !== 'function'
  ) {
    throw new EngineTransportError('Wasm module does not implement the engine ABI')
  }
  return exports as EngineExports
}

export async function createWasmTransport(options: WasmEngineOptions): Promise<(input: Uint8Array) => Uint8Array> {
  let module = options.module
  if (module === undefined) {
    const response = await fetch(options.url ?? new URL('../artifacts/engine.wasm', import.meta.url))
    if (!response.ok) throw new EngineTransportError(`Cannot load engine Wasm: HTTP ${response.status}`)
    module = await response.arrayBuffer()
  }
  const instance =
    module instanceof WebAssembly.Module ? await WebAssembly.instantiate(module, {}) : (await WebAssembly.instantiate(module, {})).instance
  const exports = exportsOf(instance)
  return input => {
    if (input.length > limits.requestBytes) throw new EngineTransportError('Wasm request exceeds 128 MiB')
    let inputPointer = 0
    let outputPointer = 0
    let outputLength = 0
    try {
      inputPointer = exports.engine_alloc(input.length) >>> 0
      if (!inputPointer) throw new EngineTransportError('Wasm request allocation failed')
      new Uint8Array(exports.memory.buffer, inputPointer, input.length).set(input)
      const packed = exports.engine_call(inputPointer, input.length)
      outputPointer = Number(packed & 0xffff_ffffn)
      outputLength = Number(packed >> 32n)
      if (!outputPointer || outputLength > limits.responseBytes) {
        throw new EngineTransportError('Wasm response violated its byte limit')
      }
      return new Uint8Array(exports.memory.buffer, outputPointer, outputLength).slice()
    } catch (cause) {
      if (cause instanceof EngineTransportError) throw cause
      throw new EngineTransportError('Wasm engine execution failed', {cause})
    } finally {
      if (outputPointer) exports.engine_free(outputPointer, outputLength)
      if (inputPointer) exports.engine_free(inputPointer, input.length)
    }
  }
}
