// What every engine transport shares, on the main thread and in the engine Worker: its limits, its errors, the
// default comparator it runs and the digest that names a module.
import type {Diagnostic} from '@githubnext/projections-schemas'

/**
 * The engine's enforced ceilings, shared by every transport: counts per extraction, `extractionDepth` in JSON levels
 * (root at depth 0) and the rest in bytes. `extractionBytes` bounds compact extraction JSON, `artifactBytes` a raw
 * saved artifact, `requestBytes`/`responseBytes` one transport envelope each way, and `comparatorInputBytes` the
 * encoded input to the default comparator. Exceeding one fails the call rather than truncating; they are ceilings,
 * not a latency or memory guarantee.
 */
export const limits = Object.freeze({
  entities: 10_000,
  relationships: 50_000,
  extractionDepth: 50,
  extractionBytes: 8 * 1024 * 1024,
  artifactBytes: 32 * 1024 * 1024,
  requestBytes: 128 * 1024 * 1024,
  responseBytes: 64 * 1024 * 1024,
  comparatorInputBytes: 64 * 1024 * 1024,
})

/**
 * A semantic failure: the engine rejected the input (invalid extraction, unsupported version, ambiguous identity, a
 * limit) or the default comparator returned an error (code `comparator-error`). The message joins each diagnostic as
 * `code at path: message`, with `/` for the root path.
 */
export class EngineError extends Error {
  /** The engine's error diagnostics, never empty: `severity`, `code`, JSON Pointer `path` and `message`. */
  readonly diagnostics: Diagnostic[]

  constructor(diagnostics: Diagnostic[]) {
    super(diagnostics.map(d => `${d.code} at ${d.path || '/'}: ${d.message}`).join('\n'))
    this.name = 'EngineError'
    this.diagnostics = diagnostics
  }
}

/**
 * A failure to reach the engine or comparator, not a judgement on the input: a spawn, Worker or fetch failure, a
 * timeout, a disposed Worker, an exceeded output limit, a Wasm trap or ABI mismatch, or a malformed response. Its
 * `cause`, when set, is the underlying error. There is no fallback engine, so the operation has not run.
 */
export class EngineTransportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'EngineTransportError'
  }
}

export interface DefaultComparator {
  /** Runs one comparator module call on UTF-8 JSON input bytes. */
  call(input: Uint8Array): Promise<Uint8Array>
  /** `sha256:` digest of the comparator module bytes. */
  digest: string
}

export async function sha256(bytes: BufferSource): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
  return `sha256:${[...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}
