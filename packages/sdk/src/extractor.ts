// Helpers for extractors, so an extractor handles none of the protocol's JSON: `request` is the request on stdin
// (`readRequest()` reads it), with accessors such as `request.root` and `request.inputs`, and `result()` writes the
// extraction to stdout (`extraction()` builds it), with the protocol's fields filled in and its items sorted. For
// extractors that write generated values (see docs/design/generated-values.md), `basis()` records what a value was
// generated from, `basisDigest()` names it, and `generations()` reuses a value the runner's generation store already
// holds for the same declared path and basis, so equal inputs give byte-identical text. Node only.
//
// The runner gives a custom extractor run with `node` this module under `@githubnext/projections/extractor`, so it
// needs nothing installed (packages/cli/node); installing the package adds its types.
import {createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'

export {DEFAULT_SCHEMA, PROTOCOL_VERSION, extraction, result} from './extractor/result.ts'
export type {ExtractionFields, Items} from './extractor/result.ts'
export {Request, readRequest, request} from './extractor/request.ts'
export type {ExtractorRequest} from '@githubnext/projections-schemas'

/** A generated value's basis: named parts, each a nonempty string of at most 256 UTF-8 bytes. */
export type Basis = Readonly<Record<string, string>>

/** JSON values, as an extraction holds them. */
export type Json = null | boolean | number | string | readonly Json[] | {readonly [key: string]: Json}

/** The most named parts one basis may have. */
export const MAX_BASIS_PARTS = 16
/** The longest value of one basis part, in UTF-8 bytes. */
export const MAX_BASIS_PART_BYTES = 256

const partName = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

/**
 * RFC 8785 canonical JSON: object keys in UTF-16 code-unit order (JavaScript's default string order), numbers and
 * strings as `JSON.stringify` writes them, no whitespace. The bytes the Engine hashes.
 */
export function canonicalJson(value: Json): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('JSON numbers are finite')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item as Json)).join(',')}]`
  const object = value as {readonly [key: string]: Json}
  return `{${Object.keys(object)
    .sort()
    .filter(key => object[key] !== undefined)
    .map(key => `${JSON.stringify(key)}:${canonicalJson(object[key]!)}`)
    .join(',')}}`
}

/** `sha256:` and the lowercase hex SHA-256 of `text`'s UTF-8 bytes. */
export function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`
}

/**
 * A basis from what a value was generated from: each part hashed (a string as its UTF-8 bytes, anything else as its
 * canonical JSON), except the parts named in `verbatim` (default `model`), kept as written so a change can say which
 * model replaced which. Put in the source the model read, the prompt (with its examples and parameters) and, when a
 * model change should count, the pinned model ID; never seeds, timestamps or credentials.
 */
export function basis(parts: Readonly<Record<string, Json>>, {verbatim = ['model']}: {verbatim?: readonly string[]} = {}): Basis {
  const names = Object.keys(parts)
  if (names.length === 0 || names.length > MAX_BASIS_PARTS)
    throw new RangeError(`A basis has 1 to ${MAX_BASIS_PARTS} parts, not ${names.length}`)
  const result: Record<string, string> = {}
  for (const name of names) {
    if (!partName.test(name)) throw new RangeError(`Basis part ${JSON.stringify(name)}: a letter, then up to 63 letters, digits, _ or -`)
    const value = parts[name]!
    if (verbatim.includes(name)) {
      if (typeof value !== 'string' || !value || Buffer.byteLength(value) > MAX_BASIS_PART_BYTES)
        throw new RangeError(
          `Basis part ${name} is kept verbatim, so it must be a nonempty string of at most ${MAX_BASIS_PART_BYTES} bytes`,
        )
      result[name] = value
    } else {
      result[name] = sha256(typeof value === 'string' ? value : canonicalJson(value))
    }
  }
  return result
}

/** A basis's digest: `sha256:` over its canonical JSON. With a declared path, the generation store's key. */
export function basisDigest(basis: Basis): string {
  return sha256(canonicalJson(basis))
}

/** Earlier generated values, by declared path and basis. */
export interface Generations {
  /** How many values the snapshot holds. */
  readonly size: number
  /** The stored value for a declaration's `path` (its pattern, `*` segments and all) and a basis, if any. */
  get(path: string, basis: Basis): Json | undefined
  /** The stored value when there is one; otherwise `produce()`'s, generated now. */
  generate<Value extends Json>(path: string, basis: Basis, produce: () => Value | Promise<Value>): Promise<Value>
}

const key = (path: string, digest: string) => `${path}\u0000${digest}`

/**
 * The generation store's snapshot the request names (`request.generations.file`, JSON Lines of `{path, basis,
 * value}`), or an empty one: the first run, `--regenerate`, or a runner that keeps no store. Never fails a run over
 * the store: an unreadable snapshot is empty.
 */
export async function generations(request: {readonly generations?: {readonly file: string} | undefined}): Promise<Generations> {
  const values = new Map<string, Json>()
  const file = request.generations?.file
  if (file) {
    const text = await readFile(file, 'utf8').catch(() => '')
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line) as {path?: unknown; basis?: unknown; value?: Json}
        if (typeof entry.path === 'string' && typeof entry.basis === 'string' && 'value' in entry)
          values.set(key(entry.path, entry.basis), entry.value as Json)
      } catch {
        // A damaged line is skipped: the value is generated again.
      }
    }
  }
  return {
    size: values.size,
    get: (path, basis) => values.get(key(path, basisDigest(basis))),
    async generate(path, basis, produce) {
      const stored = values.get(key(path, basisDigest(basis)))
      return stored !== undefined ? (stored as never) : await produce()
    },
  }
}
