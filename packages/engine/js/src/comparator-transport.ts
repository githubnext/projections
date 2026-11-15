import {EngineTransportError, limits, sha256, type DefaultComparator} from './transport.js'

/** The default comparator module: bytes or a URL, never a precompiled module, so its digest is known. */
export type ComparatorModuleOptions = {module: BufferSource; url?: never} | {url?: URL | string; module?: never}

interface ComparatorExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory
  projections_alloc(length: number): number
  projections_compare(pointer: number, length: number): bigint
}

export async function loadComparatorBytes(options: ComparatorModuleOptions = {}): Promise<ArrayBuffer> {
  if (options.module !== undefined) {
    const view = ArrayBuffer.isView(options.module)
      ? new Uint8Array(options.module.buffer, options.module.byteOffset, options.module.byteLength)
      : new Uint8Array(options.module)
    return view.slice().buffer
  }
  const response = await fetch(options.url ?? new URL('../artifacts/default-comparator.wasm', import.meta.url))
  if (!response.ok) throw new EngineTransportError(`Cannot load the default comparator: HTTP ${response.status}`)
  return response.arrayBuffer()
}

/**
 * Runs the comparator module ABI: zero imports; a fresh instance per call, so
 * no state survives between comparisons.
 */
export async function createComparatorTransport(options: ComparatorModuleOptions = {}): Promise<DefaultComparator> {
  const bytes = await loadComparatorBytes(options)
  const module = await WebAssembly.compile(bytes)
  if (WebAssembly.Module.imports(module).length) {
    throw new EngineTransportError('Comparator modules must have zero imports')
  }
  const digest = await sha256(bytes)
  return {
    digest,
    async call(input) {
      if (input.length > limits.comparatorInputBytes) throw new EngineTransportError('Comparator input exceeds 64 MiB')
      try {
        const instance = await WebAssembly.instantiate(module, {})
        const exports = instance.exports as ComparatorExports
        if (
          !(exports.memory instanceof WebAssembly.Memory) ||
          typeof exports.projections_alloc !== 'function' ||
          typeof exports.projections_compare !== 'function'
        ) {
          throw new EngineTransportError('Wasm module does not implement the comparator module ABI')
        }
        const pointer = exports.projections_alloc(input.length) >>> 0
        if (!pointer) throw new EngineTransportError('Comparator input allocation failed')
        new Uint8Array(exports.memory.buffer, pointer, input.length).set(input)
        const packed = BigInt.asUintN(64, exports.projections_compare(pointer, input.length))
        const outputPointer = Number(packed >> 32n)
        const outputLength = Number(packed & 0xffff_ffffn)
        if (!outputPointer || outputLength > limits.responseBytes || outputPointer + outputLength > exports.memory.buffer.byteLength) {
          throw new EngineTransportError('Comparator output violated its byte limit')
        }
        return new Uint8Array(exports.memory.buffer, outputPointer, outputLength).slice()
      } catch (cause) {
        if (cause instanceof EngineTransportError) throw cause
        throw new EngineTransportError('Comparator execution failed', {cause})
      }
    },
  }
}
