import type {Entity} from '@githubnext/projections-schemas'

/** One field that differs between two versions of an entity (see `fieldChanges`); values are as extracted. */
export interface FieldChange {
  /** `label`, `kind`, `confidence` or a `data` field's name. */
  key: string
  /** The field's value in Before; `undefined` when that version lacks the `data` field. */
  before: unknown
  /** The field's value in After; `undefined` when that version lacks the `data` field. */
  after: unknown
}

/** Structural equality of extracted JSON values; object key order never matters. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const other = b as unknown[]
    return a.length === other.length && a.every((value, index) => sameValue(value, other[index]))
  }
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  return [...keys].every(key => sameValue(left[key], right[key]))
}

/**
 * What differs between two versions of an entity: its label, kind and
 * confidence, then each `data` field (by name, so the order is stable). Pass
 * `fields` to compare only those `data` fields, in that order.
 */
export function fieldChanges(
  before: Entity | undefined,
  after: Entity | undefined,
  options: {fields?: readonly string[]} = {},
): FieldChange[] {
  if (!before || !after) return []
  const changes: FieldChange[] = []
  for (const key of ['label', 'kind', 'confidence'] as const) {
    if (options.fields && !options.fields.includes(key)) continue
    if (!sameValue(before[key], after[key])) changes.push({key, before: before[key], after: after[key]})
  }
  const keys = options.fields
    ? options.fields.filter(key => !['label', 'kind', 'confidence'].includes(key))
    : [...new Set([...Object.keys(before.data ?? {}), ...Object.keys(after.data ?? {})])].toSorted()
  for (const key of keys) {
    const a = before.data?.[key],
      b = after.data?.[key]
    if (!sameValue(a, b)) changes.push({key, before: a, after: b})
  }
  return changes
}
