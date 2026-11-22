import type {InspectorComparator} from '../types.js'
import {keys, record} from './guards.js'

/** Largest comparator file the Inspector accepts. */
export const maxComparatorBytes = 16 * 1024 * 1024

function decodeBase64(text: string, limit: number): Uint8Array {
  if (text.length > Math.ceil(limit / 3) * 4 || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(text)) {
    throw new Error('The local runner returned an invalid or oversized comparator file')
  }
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}
/** Validates a `GET /api/comparator` response. */
export function parseComparatorResponse(value: unknown): InspectorComparator {
  if (record(value) && keys(value) === 'default' && value.default === true) return {kind: 'default'}
  if (
    record(value) &&
    keys(value) === 'digest,rules' &&
    typeof value.rules === 'string' &&
    typeof value.digest === 'string' &&
    /^sha256:[a-f0-9]{64}$/u.test(value.digest)
  ) {
    const bytes = decodeBase64(value.rules, maxComparatorBytes)
    if (!bytes.length) throw new Error('The local runner returned an empty comparator file')
    return {kind: 'rules', bytes, digest: value.digest}
  }
  throw new Error('The local runner returned an invalid comparator response')
}
