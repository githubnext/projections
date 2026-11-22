import type {Entity, Relationship} from '@githubnext/projections-schemas'
import {variedName, variedValue, variedWords} from '@githubnext/projections-renderer-sdk/presentation'
import type {Row} from '../model.js'
import type {Side} from '../modes.js'
import {propertyPath} from '../targets/pointer.js'

/**
 * One field of a detail card's "What changed": its old and new values as text (either missing when the field
 * appeared or went away; both equal in one extraction, where nothing is compared). `path` and `side` make an item
 * data field selectable as a property target.
 */
export interface FieldChange {
  /** A stable key: `data:<name>` for item data, else the item field (`label`, `kind`, `from`, `to`, `id`). */
  key: string
  /** The field's name as shown: the data key as written, or a word for an item field ("Name", "Kind"). */
  name: string
  before?: string
  after?: string
  /** The property path (RFC 6901) of a data field, on `side`. */
  path?: string
  side?: Side
}

/**
 * One volatile value of a detail card that differs between the sides (`change.varied`): its name, its old and new
 * values as text, and whether it stayed within its tolerance. Presented neutrally, never in a change color.
 */
export interface VariedField {
  /** The pointer into the item, under `/data/`. */
  path: string
  /** The path below `/data/` as written (`durationMs`). */
  name: string
  before?: string
  after?: string
  within: boolean
  /** `within tolerance`, or `beyond tolerance (volatile)`. */
  words: string
  /** Why a tolerance couldn't be applied, from the comparison. */
  reason?: string
}

/** A varied value as one line of text: `durationMs 120 → 135 · within tolerance`. */
export function variedText(field: Pick<VariedField, 'name' | 'before' | 'after' | 'words' | 'reason'>): string {
  const values = `${field.before ?? '—'} → ${field.after ?? '—'}`
  return `${field.name} ${values} · ${field.words}${field.reason ? ` · ${field.reason}` : ''}`
}

/** A value as one line of text: strings as written, everything else as canonical JSON; `undefined` for unset values. */
export function valueText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  return typeof value === 'string' ? value : canonical(value)
}

/** JSON with object keys sorted, so equal values compare equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    return `{${Object.keys(value)
      .toSorted()
      .map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  return json(value) ?? String(value)
}

const itemFieldNames = {label: 'Name', kind: 'Kind', from: 'From', to: 'To'} as const

/** The fields that differ between an item's two sides, item fields first, then data in the after side's order. */
export function changedFields(
  before: Entity | Relationship | undefined,
  after: Entity | Relationship | undefined,
  row: Row,
): FieldChange[] {
  const fields: FieldChange[] = []
  const compare = (key: string, name: string, a: unknown, b: unknown, path?: string) => {
    const was = valueText(a)
    const now = valueText(b)
    if (was === now || (was === undefined && now === undefined)) return
    const side: Side = now === undefined ? 'before' : 'after'
    fields.push({
      key,
      name,
      ...(was === undefined ? {} : {before: was}),
      ...(now === undefined ? {} : {after: now}),
      ...(path ? {path, side} : {}),
    })
  }
  if (row.correspondence && row.correspondence !== 'exact' && row.correspondence !== 'none') {
    fields.push({key: 'id', name: 'Identity', before: row.before.join(', '), after: row.after.join(', ')})
  }
  if (before && after) {
    for (const key of ['label', 'kind', 'from', 'to'] as const) {
      compare(
        key,
        itemFieldNames[key],
        (before as unknown as Record<string, unknown>)[key],
        (after as unknown as Record<string, unknown>)[key],
      )
    }
  }
  const data = [...Object.keys(after?.data ?? {}), ...Object.keys(before?.data ?? {}).filter(key => !(after?.data && key in after.data))]
  for (const key of data) compare(`data:${key}`, key, before?.data?.[key], after?.data?.[key], propertyPath(key))
  return fields
}

/** An item's set fields, as unchanged values (one extraction). */
export function itemFields(item: Entity | Relationship, side: Side): FieldChange[] {
  return Object.entries(item.data ?? {}).flatMap(([key, value]) => {
    const text = valueText(value)
    return text === undefined ? [] : [{key: `data:${key}`, name: key, before: text, after: text, path: propertyPath(key), side}]
  })
}

/** A row's volatile values that differ, generated ones aside, with their values on each side. */
export function variedFields(row: Row, before: Entity | Relationship | undefined, after: Entity | Relationship | undefined): VariedField[] {
  return (row.varied ?? [])
    .filter(entry => !entry.generated)
    .map(entry => {
      const was = valueText(variedValue(before, entry.path))
      const now = valueText(variedValue(after, entry.path))
      return {
        path: entry.path,
        name: variedName(entry.path),
        ...(was === undefined ? {} : {before: was}),
        ...(now === undefined ? {} : {after: now}),
        within: entry.within,
        words: variedWords(entry.within),
        ...(entry.reason ? {reason: entry.reason} : {}),
      }
    })
}

/** JSON, which `JSON.stringify` doesn't give for undefined, a function or a symbol, whatever its type says. */
function json(value: unknown): string | undefined {
  return JSON.stringify(value)
}
