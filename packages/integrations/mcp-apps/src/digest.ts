// SHA-256 for the view's Workers. Chromium makes a Worker started from a Blob URL in an opaque-origin document (the
// view, in a host's sandbox) an insecure context, with no `crypto.subtle`, and the engine hashes the comparator module
// it loads (`sha256:` digests identify comparators). Where `crypto.subtle` is missing, this gives the Worker a
// `crypto.subtle.digest` for SHA-256 alone; anywhere else it changes nothing.

const k = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be,
  0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
  0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85,
  0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
  0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotate = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits))

/** The SHA-256 digest of `bytes` (FIPS 180-4). */
export function sha256(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
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
      const s0 = rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)
      const s1 = rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10)
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) | 0
    }
    let [a, b, c, d, e, f, g, h] = hash as unknown as [number, number, number, number, number, number, number, number]
    for (let t = 0; t < 64; t++) {
      const t1 = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + k[t]! + w[t]!) | 0
      const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0
      h = g
      g = f
      f = e
      e = (d + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }
    const next = [a, b, c, d, e, f, g, h]
    for (let index = 0; index < 8; index++) hash[index] = (hash[index]! + next[index]!) | 0
  }
  const digest = new Uint8Array(32)
  const out = new DataView(digest.buffer)
  for (let index = 0; index < 8; index++) out.setUint32(index * 4, hash[index]!)
  return digest
}

/** The bytes of a `BufferSource`. */
const bytesOf = (data: BufferSource) =>
  data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)

/** Gives a context without `crypto.subtle` a SHA-256 `crypto.subtle.digest`; returns whether it had to. */
export function installDigest(scope: {crypto?: Crypto} = globalThis): boolean {
  if (!scope.crypto || scope.crypto.subtle) return false
  const subtle = {
    async digest(algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> {
      const name = typeof algorithm === 'string' ? algorithm : algorithm.name
      if (name.toUpperCase() !== 'SHA-256') throw new DOMException(`${name} is unavailable in this context`, 'NotSupportedError')
      return sha256(bytesOf(data)).buffer
    },
  }
  Object.defineProperty(scope.crypto, 'subtle', {value: subtle, configurable: true})
  return true
}
