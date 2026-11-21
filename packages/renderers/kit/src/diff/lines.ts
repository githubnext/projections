import type {Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {fieldChanges, sameValue} from './fields.js'

/** One field change as text, for drawing inline (see `ValueChange` and GraphCanvas `changedFields`). */
export interface FieldLine {
  /** The field's name, or a leaf's path within an object field (`hardwareProfile.vmSize`, `ingress[0].from_port`). */
  key: string
  /** The Before value as written (`formatValue`): `null` when absent. */
  before: string
  /** The After value as written (`formatValue`): `null` when absent. */
  after: string
  /**
   * The line only says something changed, in words (`key`, such as `2 other fields changed`), without values: for
   * changes too bulky for a card, which the host's details show.
   */
  summary?: true
  /** `key` is in plain words (`test tokens`), drawn as human text rather than as the field's identifier. */
  prose?: true
}

/** An extracted value as it is written: strings as they are, everything else as JSON, and an absent value as `null`. */
export function formatValue(value: unknown): string {
  if (value === undefined || value === null) return 'null'
  return typeof value === 'string' ? value : JSON.stringify(value)
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * What differs between two values, down to the leaves: objects by key
 * (`hardwareProfile.vmSize`) and arrays of the same length by index
 * (`ingress[0].from_port`), in key order; anything else, or arrays whose
 * length changed, whole.
 */
export function leafChanges(a: unknown, b: unknown, path: string): {key: string; before: unknown; after: unknown}[] {
  if (sameValue(a, b)) return []
  if (isRecord(a) && isRecord(b)) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .sort()
      .flatMap(key => leafChanges(a[key], b[key], path ? `${path}.${key}` : key))
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && path) {
    return a.flatMap((value, index) => leafChanges(value, b[index], `${path}[${index}]`))
  }
  return [{key: path, before: a, after: b}]
}

/**
 * Field changes between two versions as text lines (see `fieldChanges`),
 * `data` fields only unless `fields` names others; values verbatim
 * (`formatValue`). Pass `object` to compare the fields of one object-valued
 * `data` field instead, such as a resource's `values`, down to the leaves
 * that changed (see `leafChanges`), so a nested setting reads as its own path
 * (`properties.hardwareProfile.vmSize`) rather than the whole object twice.
 */
export function fieldLines(
  row: EntityChange<Entity>,
  options: {fields?: readonly string[]; exclude?: readonly string[]; object?: string} = {},
): FieldLine[] {
  const {before, after} = row
  if (!before || !after) return []
  const exclude = new Set(options.exclude ?? [])
  if (options.object) {
    const of = (entity: Entity) => {
      const value = entity.data?.[options.object!]
      return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
    }
    return leafChanges(of(before), of(after), '')
      .filter(change => !exclude.has(change.key.split(/[.[]/)[0]!))
      .map(change => ({key: change.key, before: formatValue(change.before), after: formatValue(change.after)}))
  }
  const fields = options.fields ?? [...new Set([...Object.keys(before.data ?? {}), ...Object.keys(after.data ?? {})])].sort()
  return fieldChanges(before, after, {fields})
    .filter(change => !exclude.has(change.key))
    .map(change => ({key: change.key, before: formatValue(change.before), after: formatValue(change.after)}))
}
