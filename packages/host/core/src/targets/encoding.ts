import {isProjectionTarget} from './target.js'
import type {ProjectionTarget} from './target.js'

/**
 * A compact, URL-safe form of a target, for deep links:
 * `entity.after.<id>` or `relationship.before.<id>.<path>`, with the ID and
 * path percent-encoded.
 */
export function encodeTarget(target: ProjectionTarget): string {
  const encode = (text: string) => encodeURIComponent(text).replace(/\./gu, '%2E')
  return [target.kind, target.side, encode(target.id), ...(target.path === undefined ? [] : [encode(target.path)])].join('.')
}

/** Reads a target written by `encodeTarget`; `undefined` when it isn't one. */
export function decodeTarget(text: string): ProjectionTarget | undefined {
  const parts = text.split('.')
  if (parts.length < 3 || parts.length > 4) return undefined
  try {
    const [kind, side, id, path] = [
      parts[0],
      parts[1],
      decodeURIComponent(parts[2]!),
      parts[3] === undefined ? undefined : decodeURIComponent(parts[3]),
    ]
    const target = {kind, side, id, ...(path === undefined ? {} : {path})}
    return isProjectionTarget(target) ? target : undefined
  } catch {
    return undefined
  }
}
