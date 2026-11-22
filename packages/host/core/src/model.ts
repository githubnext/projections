import {
  entityLabels,
  regenerated,
  relationshipLabel,
  variedBeyond,
  variedWithinTolerance,
} from '@githubnext/projections-renderer-sdk/presentation'
import type {
  ChangeContext,
  ChangeStatus,
  Comparison,
  Correspondence,
  Entity,
  Extraction,
  Relationship,
  Varied,
} from '@githubnext/projections-schemas'
import {codeSpan, escapeProse} from '@githubnext/projections-schemas'

const codes = (ids: readonly string[]): string => ids.map(codeSpan).join(', ')

/** What a view presents: one extraction, or a comparison of two. */
export type ViewSubject =
  | {mode: 'extraction'; extraction: Extraction}
  | {mode: 'comparison'; before: Extraction; after: Extraction; comparison: Comparison}

/** One entity, relationship or change as the host's table and text views present it. */
export interface Row {
  /** The entity or relationship ID, or the change ID in a comparison. */
  id: string
  collection: 'entities' | 'relationships'
  label: string
  kind: string
  from?: string
  to?: string
  status?: ChangeStatus
  correspondence?: Correspondence
  before: string[]
  after: string[]
  summary?: string
  /** Zero-based comparison step, for changes. */
  step?: number
  /** Whether `label` was made from the relationship's endpoints ("api → queue") rather than given by the extraction. */
  derivedLabel?: boolean
  /**
   * The change's volatile values that differ (`change.varied`): an `unchanged` row with them varied only within
   * tolerance; a `modified` one may have values beyond it.
   */
  varied?: readonly Varied[]
  /** The comparison's context for the change (`change.context`): the other items a person needs to read it. */
  context?: ChangeContext
}

type Labels = (id: string) => string | undefined

/** An item's label: its own, else for a relationship its endpoints' labels (`relationshipLabel`), else its ID. */
function itemLabel(item: Entity | Relationship, labels: Labels): {label: string; derivedLabel?: true} {
  if (item.label) return {label: item.label}
  if ('from' in item) return {label: relationshipLabel(item, labels), derivedLabel: true}
  return {label: item.id}
}

function plain(collection: Row['collection'], item: Entity | Relationship, labels: Labels): Row {
  return {
    id: item.id,
    collection,
    ...itemLabel(item, labels),
    kind: item.kind,
    before: [],
    after: [item.id],
    ...('from' in item ? {from: item.from, to: item.to} : {}),
  }
}

/**
 * Rows for the host's built-in views. For a comparison, every change (in step
 * order) followed by every unchanged item; identity comes only from the
 * comparison.
 */
export function subjectRows(subject: ViewSubject): Row[] {
  if (subject.mode === 'extraction') {
    return [
      ...subject.extraction.entities.map(item => plain('entities', item, entityLabels(subject.extraction))),
      ...subject.extraction.relationships.map(item => plain('relationships', item, entityLabels(subject.extraction))),
    ]
  }
  const {before, after, comparison} = subject
  const lookup = {
    before: {
      entities: new Map(before.entities.map(item => [item.id, item])),
      relationships: new Map<string, Entity | Relationship>(before.relationships.map(item => [item.id, item])),
    },
    after: {
      entities: new Map(after.entities.map(item => [item.id, item])),
      relationships: new Map<string, Entity | Relationship>(after.relationships.map(item => [item.id, item])),
    },
  }
  // Endpoint labels come from the extraction the relationship is taken from.
  const labels = {before: entityLabels(before), after: entityLabels(after)}
  const stepOf = new Map<string, number>()
  comparison.steps.forEach((step, index) =>
    step.changes.forEach(id => {
      stepOf.set(id, index)
    }),
  )
  const referenced = {before: new Set<string>(), after: new Set<string>()}
  const changes: Row[] = comparison.changes
    .map(change => {
      for (const id of change.before) referenced.before.add(`${change.collection}:${id}`)
      for (const id of change.after) referenced.after.add(`${change.collection}:${id}`)
      const fromAfter = change.after[0] !== undefined ? lookup.after[change.collection].get(change.after[0]) : undefined
      const item = fromAfter ?? (change.before[0] !== undefined ? lookup.before[change.collection].get(change.before[0]) : undefined)
      const step = stepOf.get(change.id)
      return {
        id: change.id,
        collection: change.collection,
        ...(item ? itemLabel(item, fromAfter ? labels.after : labels.before) : {label: change.id}),
        kind: item?.kind ?? '',
        ...(item && 'from' in item ? {from: item.from, to: item.to} : {}),
        status: change.status,
        correspondence: change.correspondence,
        before: change.before,
        after: change.after,
        ...(change.summary ? {summary: change.summary} : {}),
        ...(step === undefined ? {} : {step}),
        ...(change.varied?.length !== undefined && change.varied.length > 0 ? {varied: change.varied} : {}),
        ...(change.context ? {context: change.context} : {}),
      }
    })
    .sort((a, b) => (a.step ?? Infinity) - (b.step ?? Infinity))
  const unchanged = (['entities', 'relationships'] as const).flatMap(collection =>
    (after[collection] as (Entity | Relationship)[])
      .filter(item => !referenced.after.has(`${collection}:${item.id}`))
      .map(item => ({
        ...plain(collection, item, labels.after),
        status: 'unchanged' as const,
        correspondence: 'exact' as const,
        before: [item.id],
      })),
  )
  return [...changes, ...unchanged]
}

const statusWords: Record<ChangeStatus, string> = {added: 'Added', removed: 'Removed', modified: 'Modified', unchanged: 'Unchanged'}

/** A change status as a sentence-case label ("Added"), for chips and badges; the status itself stays the data value. */
export function statusLabel(status: ChangeStatus): string {
  return statusWords[status]
}

/**
 * A one-sentence description of a change, shared by the text view and accessible
 * labels, as protocol prose: IDs are inline code, labels are escaped prose and the
 * comparator's summary keeps its own code spans. Draw it with `Prose`, or use
 * `plainProse` for a plain-text label.
 */
export function describeChange(row: Row): string {
  const noun = row.collection === 'entities' ? 'entity' : 'relationship'
  let verb = statusWords[row.status ?? 'unchanged']
  if (row.status === 'unchanged' && row.correspondence === 'declared') verb = 'Renamed'
  else if (row.status === 'unchanged' && row.correspondence === 'split') verb = 'Split'
  else if (row.status === 'unchanged' && row.correspondence === 'merge') verb = 'Merged'
  const identity =
    row.correspondence === 'declared'
      ? ` (was ${codes(row.before)})`
      : row.correspondence === 'split' || row.correspondence === 'merge'
        ? ` (${codes(row.before)} → ${codes(row.after)})`
        : ''
  return `${verb} ${noun} ${row.label === row.id ? codeSpan(row.label) : escapeProse(row.label)}${row.label === row.id || row.derivedLabel ? '' : ` [${codeSpan(row.id)}]`}${identity}${row.summary ? `: ${row.summary}` : ''}.`
}

/** How many changes varied, by kind (see `subjectVariation`). */
export interface Variation {
  /** Unchanged items with a volatile value (other than a generated one) that varied within tolerance. */
  within: number
  /** Modified items with a volatile value beyond its tolerance. */
  beyond: number
  /** Unchanged items with a generated value regenerated from the same inputs. */
  regenerated: number
}

/**
 * How many changes varied: `within`, unchanged items whose volatile values (other than generated ones) varied only
 * within tolerance; `beyond`, modified items with a volatile value beyond it; `regenerated`, unchanged items whose
 * generated values were regenerated from the same inputs. An unchanged item with both counts in both. Counted from
 * the rows; `undefined` when nothing varied (and for one extraction).
 */
export function subjectVariation(subject: ViewSubject, rows: readonly Row[]): Variation | undefined {
  if (subject.mode !== 'comparison') return undefined
  const variation = {
    within: rows.filter(row => variedWithinTolerance(row)).length,
    beyond: rows.filter(row => variedBeyond(row)).length,
    regenerated: rows.filter(row => regenerated(row)).length,
  }
  return variation.within || variation.beyond || variation.regenerated ? variation : undefined
}

/** How many of `rows` have each change status; a row without one (an extraction's) counts as `unchanged`. */
export function rowStatusCounts(rows: readonly Row[]): Record<ChangeStatus, number> {
  const counts: Record<ChangeStatus, number> = {added: 0, removed: 0, modified: 0, unchanged: 0}
  for (const row of rows) counts[row.status ?? 'unchanged']++
  return counts
}

/** Finds the entity or relationship records a row refers to. */
export function rowItems(subject: ViewSubject, row: Row): {before: (Entity | Relationship)[]; after: (Entity | Relationship)[]} {
  const find = (extraction: Extraction, ids: string[]) =>
    ids
      .map(id => (row.collection === 'entities' ? extraction.entities : extraction.relationships).find(item => item.id === id))
      .filter((item): item is Entity | Relationship => item !== undefined)
  if (subject.mode === 'extraction') return {before: [], after: find(subject.extraction, row.after)}
  return {before: find(subject.before, row.before), after: find(subject.after, row.after)}
}
