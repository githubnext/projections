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
  const declared = [text(before.data?.['type']), text(after.data?.['type'])] as const
  if (from !== to) lines.push({key: 'type', word: 'Type changed', before: from, after: to})
  else if (declared[0] !== declared[1])
    lines.push({
      key: 'type',
      word: 'Type changed',
      before: declared[0] ?? formatValue(undefined),
      after: declared[1] ?? formatValue(undefined),
    })
  const was = before.data?.['nullable'] === true,
    now = after.data?.['nullable'] === true
  if (was && !now) lines.push({key: 'nullable', word: 'Made required'})
  if (!was && now) lines.push({key: 'nullable', word: 'Made optional'})
  return lines.length ? lines : otherFields(before, after, [])
}

/** A key's own name: its database name, else its label. */
const keyName = (entity: Entity) => text(entity.data?.['databaseName']) ?? entity.label

/** What changed about a key or index: its name (`Renamed`), the columns it covers, its kind, else its other changed fields. */
export function keyChanges(row: EntityChange<Entity>): ChangeLine[] {
  const {before, after} = row
  if (!before || !after) return []
  const lines: ChangeLine[] = []
  if (keyName(before) !== keyName(after)) lines.push({key: 'label', word: 'Renamed', before: keyName(before), after: keyName(after)})
  const columns = [keyColumnNames(before).join(', '), keyColumnNames(after).join(', ')] as const
  if (columns[0] !== columns[1]) lines.push({key: 'columns', word: 'Columns changed', before: columns[0], after: columns[1]})
  if (keyType(before) !== keyType(after)) lines.push({key: 'type', word: 'Kind changed', before: keyType(before), after: keyType(after)})
  return lines.length ? lines : otherFields(before, after, [])
}
