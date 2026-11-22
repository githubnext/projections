import type {ProjectionEngine} from '@githubnext/projections-schemas'
import {decodeResponse} from './decoding.js'
import {encode} from './encoding.js'
import {engine} from './engine.js'
import {createWasmTransport, type WasmEngineOptions} from './wasm-transport.js'
import {createComparatorTransport, type ComparatorModuleOptions} from './comparator-transport.js'

export {EngineError, EngineTransportError, limits} from './transport.js'
export type {WasmEngineOptions} from './wasm-transport.js'
export type {ComparatorModuleOptions} from './comparator-transport.js'

/**
 * Creates the engine in this thread from its WebAssembly build, for browsers and Node, with no Node APIs. Both
 * modules are fetched (or taken from `module`) and instantiated before it resolves; by default they are the packaged
 * `artifacts/engine.wasm` and `artifacts/default-comparator.wasm` beside this module, which bundlers must copy. Semantic work
 * runs synchronously on the calling thread, so use `createWorkerEngine` for large extractions in a UI.
 *
 * @param options - The engine module: `{url}` to fetch it from elsewhere, or `{module}` as a compiled
 *   `WebAssembly.Module` or its bytes.
 * @param comparator - The default comparator module: `{url}` or `{module}` bytes, never a compiled module, so its
 *   digest can be computed.
 * @returns The engine, once both modules are ready.
 * @throws `EngineTransportError` when a module cannot be fetched (non-2xx), does not implement its ABI, or the
 *   comparator has imports.
 *
 * @example
 * ```ts
 * import {createWasmEngine} from '@githubnext/projections-engine/browser'
 *
 * const engine = await createWasmEngine()
 * const comparison = await engine.compare(before, after)
 * ```
 */
export async function createWasmEngine(
  options: WasmEngineOptions = {},
  comparator: ComparatorModuleOptions = {},
): Promise<ProjectionEngine> {
  const invoke = await createWasmTransport(options)
  const defaultComparator = await createComparatorTransport(comparator)
  return engine(
    async request => decodeResponse(invoke(encode(request))),
    async () => defaultComparator,
  )
}
