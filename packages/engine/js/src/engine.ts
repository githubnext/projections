// The engine API over a transport: each operation is one request, and comparisons run the default comparator.
import type {
  DefaultComparatorOptions,
  CanonicalExtraction,
  Comparison,
  DefinitionPairing,
  EngineRequest,
  EngineResponse,
  Extraction,
  Json,
  PairingSide,
  ProjectionEngine,
  Variation,
} from '@githubnext/projections-schemas'
import {decodeComparatorOutput} from './decoding.js'
import {encodeComparatorInput} from './encoding.js'
import {EngineError, type DefaultComparator} from './transport.js'

/** Only what pairing reads, so a pair of large extractions isn't sent to the engine whole; a missing field stays missing. */
function pairingSide(document: PairingSide): unknown {
  const side = document as Partial<PairingSide> | undefined
  const present = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined))
  return {
    projection: present({id: side?.projection?.id}),
    provenance: present({definition: side?.provenance?.definition, definitionDigest: side?.provenance?.definitionDigest}),
  }
}

/**
 * Builds the `ProjectionEngine` API over one transport, which every factory (`createNativeEngine`, `createWasmEngine`,
 * `createWorkerEngine`) wraps. Each operation sends one `version: 0` request to `invoke`; a response with `ok: false`
 * rejects with an `EngineError` carrying its diagnostics. `compare` runs the default comparator from `load` on the
 * encoded extractions, then sends its output through `validate-comparison`, so a comparator result is never trusted
 * unchecked. `load` is called at most once, on the first `compare` or `defaultComparator`; a rejected load is cached
 * too.
 *
 * @param invoke - Sends one engine request and resolves to its response; transport failures should reject with
 *   `EngineTransportError`.
 * @param load - Loads the default comparator module that `compare` runs and whose digest `defaultComparator` reports.
 * @returns The engine API; every method returns a promise.
 *
 * @example
 * ```ts
 * const invoke = await createWasmTransport({})
 * const defaultComparator = await createComparatorTransport({})
 * const wasm = engine(
 *   async request => decodeResponse(invoke(encode(request))),
 *   async () => defaultComparator,
 * )
 * const {digest} = await wasm.canonicalize(await wasm.decode(rawExtractionJson))
 * ```
 */
export function engine(
  invoke: (request: EngineRequest) => Promise<EngineResponse>,
  load: () => Promise<DefaultComparator>,
): ProjectionEngine {
  let loading: Promise<DefaultComparator> | undefined
  const comparator = () => (loading ??= load())
  async function result<T>(request: EngineRequest): Promise<T> {
    const response = await invoke(request)
    if (!response.ok) throw new EngineError(response.diagnostics)
    return response.result as T
  }
  const validateComparison = (before: unknown, after: unknown, comparison: unknown) =>
    result<Comparison>({version: 0, operation: 'validate-comparison', before, after, comparison})
  return {
    parseJson: json => result<Json>({version: 0, operation: 'parse-json', json}),
    normalize: extraction => result<Extraction>({version: 0, operation: 'normalize', extraction}),
    decode: json => result<Extraction>({version: 0, operation: 'decode', json}),
    canonicalize: extraction => result<CanonicalExtraction>({version: 0, operation: 'canonicalize', extraction}),
    validateComparison,
    vary: (before, after) => result<Variation>({version: 0, operation: 'vary', before, after}),
    pair: (before, after) =>
      result<DefinitionPairing>({version: 0, operation: 'pair', before: pairingSide(before), after: pairingSide(after)}),
    async compare(before, after, options: DefaultComparatorOptions = {}) {
      const input = encodeComparatorInput(before, after, options)
      const output = decodeComparatorOutput(await (await comparator()).call(input))
      return validateComparison(before, after, output)
    },
    defaultComparator: async () => ({id: 'default', digest: (await comparator()).digest}),
  }
}
