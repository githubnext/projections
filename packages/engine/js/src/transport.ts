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
  call: (input: Uint8Array) => Promise<Uint8Array>
  /** `sha256:` digest of the comparator module bytes. */
  digest: string
}

/**
 * `sha256:` digest of `bytes`. With Web Crypto where there is `crypto.subtle`, else in JavaScript: a page that isn't a
 * secure context (the agent viewer framed by an app whose own document is plain http or a custom scheme) has none, nor
 * do its Workers.
 */
export async function sha256(bytes: BufferSource): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  const digest = subtle ? new Uint8Array(await subtle.digest('SHA-256', bytes)) : sha256Bytes(bytesOf(bytes))
  return `sha256:${[...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

const bytesOf = (data: BufferSource) =>
  data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)

const roundConstants = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be,
  0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
  0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
  0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
  0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotate = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits))

/** The SHA-256 digest of `bytes` (FIPS 180-4), for contexts without Web Crypto. */
export function sha256Bytes(bytes: Uint8Array): Uint8Array {
  // The message, a 1 bit, zeros to 56 bytes modulo 64, then its length in bits as a big-endian 64-bit number.
  const length = Math.ceil((bytes.length + 9) / 64) * 64
  const padded = new Uint8Array(length)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(length - 8, Math.floor(bytes.length / 0x20000000))
  view.setUint32(length - 4, (bytes.length * 8) >>> 0)
  const hash = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const w = new Uint32Array(64)
  for (let block = 0; block < length; block += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(block + t * 4)
    for (let t = 16; t < 64; t++) {
      const a = w[t - 15]!
      const b = w[t - 2]!
      w[t] = (w[t - 16]! + (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) + w[t - 7]! + (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))) | 0
    }
    const v = Array.from(hash)
    for (let t = 0; t < 64; t++) {
      const [a, b, c, , e, f, g, h] = v as [number, number, number, number, number, number, number, number]
      const t1 = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + roundConstants[t]! + w[t]!) | 0
      const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0
      v.pop()
      v.unshift((t1 + t2) | 0)
      v[4] = (v[4]! + t1) | 0
    }
    for (let index = 0; index < 8; index++) hash[index] = (hash[index]! + v[index]!) | 0
  }
  const digest = new Uint8Array(32)
  const out = new DataView(digest.buffer)
  for (let index = 0; index < 8; index++) out.setUint32(index * 4, hash[index]!)
  return digest
}
