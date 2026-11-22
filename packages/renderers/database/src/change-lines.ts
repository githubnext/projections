import type {Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {fieldChanges, formatValue} from '@githubnext/projections-renderer-kit'
import {keyColumnNames, keyType} from './vocabulary.js'
import {baseType} from './types.js'

/** One thing that changed about a row, in words, with the old and new values when there are any. */
export interface ChangeLine {
  /** `label`, `type`, `nullable`, `columns` or `fields`. */
  key: string
  word: string
  before?: string
  after?: string
}

const text = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : undefined)
export const both = (row: EntityChange<Entity>) => row.before !== undefined && row.after !== undefined

/** Changed `data` fields other than those already said, by name, as one line. */
function otherFields(before: Entity, after: Entity, said: readonly string[]): ChangeLine[] {
  const keys = fieldChanges(before, after)
    .map(change => change.key)
    .filter(key => !['label', 'kind', 'confidence', ...said].includes(key))
  return keys.length ? [{key: 'fields', word: `${keys.join(', ')} changed`}] : []
}

/**
 * What changed about a column, from its two versions only: its name
 * (`Renamed`), its shown type (`Type changed`, the native type when the
 * extractor knows it, else the declared one), its nullability (`Made
 * required`, `Made optional`), else the names of its other changed fields.
 */
export function columnChanges(row: EntityChange<Entity>): ChangeLine[] {
  const {before, after} = row
  if (!before || !after) return []
  const lines: ChangeLine[] = []
  if (before.label !== after.label) lines.push({key: 'label', word: 'Renamed', before: before.label, after: after.label})
  const from = baseType(before),
    to = baseType(after)
  const declared = [text(before.data?.type), text(after.data?.type)] as const
  if (from !== to) lines.push({key: 'type', word: 'Type changed', before: from, after: to})
  else if (declared[0] !== declared[1]) {
    lines.push({
      key: 'type',
      word: 'Type changed',
      before: declared[0] ?? formatValue(undefined),
      after: declared[1] ?? formatValue(undefined),
    })
  }
  const was = before.data?.nullable === true,
    now = after.data?.nullable === true
  if (was && !now) lines.push({key: 'nullable', word: 'Made required'})
  if (!was && now) lines.push({key: 'nullable', word: 'Made optional'})
  return lines.length ? lines : otherFields(before, after, [])
}

/**
 * A foreign key's referential action as written: Prisma's and SQL's word (`Cascade`, `SET NULL`), the last part of a
 * Django callable (`django.db.models.deletion.PROTECT`: `PROTECT`; the whole path when `qualified`), or `default` when
 * none is declared.
 */
export function referentialAction(value: unknown, {qualified = false}: {qualified?: boolean} = {}): string {
  if (typeof value === 'string' && value.length > 0) return value
  const callable = value && typeof value === 'object' ? text((value as Record<string, unknown>).callable) : undefined
  if (callable) return qualified ? callable : callable.split('.').at(-1)!
  return value === undefined || value === null ? 'default' : formatValue(value)
}

/** Whether two declared actions differ: as declared, so a qualified callable's module counts, and unset is `default`. */
const declared = (value: unknown) => JSON.stringify(value ?? null)

/** A foreign key's referential actions, each a line when it changed: `On delete changed`, `On update changed`. */
const actions = [
  ['onDelete', 'on-delete', 'On delete changed'],
  ['onUpdate', 'on-update', 'On update changed'],
] as const

/** A key's own name: its database name, else its label. */
const keyName = (entity: Entity) => text(entity.data?.databaseName) ?? entity.label

/**
 * What changed about a key or index: its name (`Renamed`), the columns it covers, its kind, a foreign key's referential
 * actions (`On delete changed`, `Restrict` → `Cascade`), else its other changed fields.
 */
export function keyChanges(row: EntityChange<Entity>): ChangeLine[] {
  const {before, after} = row
  if (!before || !after) return []
  const lines: ChangeLine[] = []
  if (keyName(before) !== keyName(after)) lines.push({key: 'label', word: 'Renamed', before: keyName(before), after: keyName(after)})
  const columns = [keyColumnNames(before).join(', '), keyColumnNames(after).join(', ')] as const
  if (columns[0] !== columns[1]) lines.push({key: 'columns', word: 'Columns changed', before: columns[0], after: columns[1]})
  if (keyType(before) !== keyType(after)) lines.push({key: 'type', word: 'Kind changed', before: keyType(before), after: keyType(after)})
  for (const [field, key, word] of actions) {
    const from = before.data?.[field],
      to = after.data?.[field]
    if (declared(from) === declared(to)) continue
    // Short where that tells them apart; in full where it wouldn't (two modules' `PROTECT`).
    const qualified = referentialAction(from) === referentialAction(to)
    lines.push({key, word, before: referentialAction(from, {qualified}), after: referentialAction(to, {qualified})})
  }
  return lines.length
    ? lines
    : otherFields(
        before,
        after,
        actions.map(([field]) => field),
      )
}

/**
 * What changed about a key a column's marker stands for (a single-column primary or foreign key), as lines under the
 * column: its referential actions as they are (`On delete changed`), the rest named for the key (`Foreign key
 * renamed`), each keyed `key-…` so they never read as the column's own changes.
 */
export function markerChanges(row: EntityChange<Entity>, title: string): ChangeLine[] {
  return keyChanges(row).map(line =>
    line.key === 'on-delete' || line.key === 'on-update'
      ? line
      : {...line, key: `key-${line.key}`, word: `${title} ${line.word.charAt(0).toLowerCase()}${line.word.slice(1)}`},
  )
}
