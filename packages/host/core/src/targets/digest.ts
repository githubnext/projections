import type {Entity, Extraction, ProjectionEngine, Relationship} from '@githubnext/projections-schemas'
import {sha256} from '../compare.js'
import {readPointer} from './pointer.js'
import {collectionOf, type ProjectionTarget} from './target.js'

/** RFC 8785 (JSON Canonicalization Scheme) text of a JSON value. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * Digests of targets in an extraction: `sha256:` over the canonical JSON of
 * the item (or of the value at `path` in its `data`), after the engine
 * normalizes and canonicalizes the extraction. A consumer stores the digest
 * with, for example, a comment, and later compares it with the digest at
 * another revision to tell whether the target changed. `undefined` when the
 * target doesn't exist. `side` is ignored: the extraction is the side.
 */
export async function targetDigests(
  engine: ProjectionEngine,
  extraction: unknown,
  targets: readonly ProjectionTarget[],
): Promise<(string | undefined)[]> {
  const {canonical} = await engine.canonicalize(extraction)
  const normalized = JSON.parse(canonical) as Extraction
  const encoder = new TextEncoder()
  return Promise.all(
    targets.map(async target => {
      const item = (normalized[collectionOf(target.kind)] as (Entity | Relationship)[] | undefined)?.find(
        candidate => candidate.id === target.id,
      )
      if (!item) return undefined
      const value = target.path === undefined ? item : readPointer(item.data ?? {}, target.path)
      return value === undefined ? undefined : sha256(encoder.encode(canonicalJson(value)))
    }),
  )
}

/** The digest of one target in an extraction; see `targetDigests`. */
export async function targetDigest(engine: ProjectionEngine, extraction: unknown, target: ProjectionTarget): Promise<string | undefined> {
  return (await targetDigests(engine, extraction, [target]))[0]
}
