import {rowItems} from './model.js'
import type {Row, ViewSubject} from './model.js'
import {changeParts, changeTags} from './details/change.js'
import type {ChangePart} from './details/change.js'
import {rowConnections} from './details/connections.js'
import type {DetailConnection} from './details/connections.js'
import {rowEvidence} from './details/evidence.js'
import type {DetailEvidence} from './details/evidence.js'
import {changedFields, itemFields, variedFields} from './details/fields.js'
import type {FieldChange, VariedField} from './details/fields.js'
import {generatedFields} from './details/generated.js'
import type {GeneratedField} from './details/generated.js'

/** What a detail card shows for a row: what changed, where in the code, and how it connects. */
export interface RowDetails {
  parts: ChangePart[]
  /** The comparator's classification of the change, as words ("Breaking", "Scope broadened"). */
  tags: string[]
  summary?: string
  /** Fields that changed (in a comparison), or the item's fields (in one extraction); unset values are left out. */
  fields: FieldChange[]
  /** How many more fields there are than `fields` lists. */
  moreFields: number
  /**
   * The change's volatile values that differ, within tolerance or beyond it, with their values. `fields` leaves them
   * out: a volatile value is listed here, neutrally, rather than as a change.
   */
  varied: VariedField[]
  /** The item's generated values, marked Generated; listed first, and left out of `fields` and `varied`. */
  generated: GeneratedField[]
  evidence: DetailEvidence[]
  moreEvidence: number
  connections: DetailConnection[]
  moreConnections: number
}

/**
 * The most of each list `rowDetails` returns: changed `fields` (default 12), `evidence` locations (default 6) and
 * `connections` per direction (default 6). The rest are counted in its `moreFields`, `moreEvidence` and
 * `moreConnections`.
 */
export interface RowDetailsLimits {
  fields?: number
  evidence?: number
  /** Per direction. */
  connections?: number
}

/**
 * What a detail card shows for a row: its change (parts, the comparator's tags and summary) and the fields that
 * changed, old and new; its evidence (the after side's, then before-side files the after side doesn't name); and its
 * connections: an entity's outgoing and incoming relationships, or a relationship's endpoints. `rows` are the
 * subject's rows (`subjectRows`), to find connections.
 */
export function rowDetails(subject: ViewSubject, row: Row, rows: readonly Row[], limits: RowDetailsLimits = {}): RowDetails {
  const maxFields = limits.fields ?? 12
  const maxEvidence = limits.evidence ?? 6
  const items = rowItems(subject, row)
  const comparing = subject.mode === 'comparison'
  const variedPaths = new Set((row.varied ?? []).map(entry => entry.path))
  const {generated, hidden} = generatedFields(subject, row, items)
  const fields = (
    comparing ? changedFields(items.before[0], items.after[0], row) : items.after[0] ? itemFields(items.after[0], 'after') : []
  ).filter(field => !(field.path && (variedPaths.has(`/data${field.path}`) || hidden.has(`/data${field.path}`))))
  const evidence = rowEvidence(items)
  const {connections, more} = rowConnections(row, rows, limits.connections ?? 6)
  return {
    parts: changeParts(row),
    tags: changeTags(subject, row.id),
    ...(row.summary ? {summary: row.summary} : {}),
    fields: fields.slice(0, maxFields),
    moreFields: Math.max(0, fields.length - maxFields),
    varied: variedFields(row, items.before[0], items.after[0]),
    generated,
    evidence: evidence.slice(0, maxEvidence),
    moreEvidence: Math.max(0, evidence.length - maxEvidence),
    connections,
    moreConnections: more,
  }
}
