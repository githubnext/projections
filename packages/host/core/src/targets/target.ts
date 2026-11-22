import type {Entity, Extraction, Relationship} from '@githubnext/projections-schemas'
import {isPropertyPath, type AnnotationTone} from '@githubnext/projections-renderer-sdk/protocol'
import type {Row, ViewSubject} from '../model.js'
import {readPointer} from './pointer.js'

/**
 * Something a person can point at in a projection, anchored to extraction
 * identity (never to change or row IDs, which depend on the comparator):
 *
 * - `kind` and `id`: an entity or relationship of an extraction.
 * - `side`: which extraction of a comparison, `before` or `after`; always
 *   `after` for a single extraction. Like a diff's left and right, an item
 *   that was removed exists only `before`.
 * - `path`: optionally a property of the item, as an RFC 6901 JSON pointer
 *   into its `data` (for example `/owner` or `/ports/0`).
 */
export interface ProjectionTarget {
  kind: 'entity' | 'relationship'
  id: string
  side: 'before' | 'after'
  path?: string
}

/** The selected presented item and the extraction items it stands for. */
export interface ProjectionSelection {
  /** The selection ID shared by renderers and the host's views (a comparison's change ID, or the item ID). */
  rowId: string
  /**
   * Every target the selected row presents: its items on each side. A
   * renamed, split or merged row has several; a removed item only `before`,
   * an added one only `after`.
   */
  targets: ProjectionTarget[]
  /** The specific target chosen, when one was: a property, or a target the host selected with `selectTarget`. */
  target?: ProjectionTarget
}

/** Where a target is presented, or why it isn't. */
export type TargetResolution =
  | {status: 'present'; rowId: string}
  /**
   * `item`: no item with this kind and ID on that side. `side`: a single
   * extraction has no `before`. `property`: the item exists (`rowId`) but has
   * no value at `path`.
   */
  | {status: 'absent'; reason: 'item' | 'side' | 'property'; rowId?: string}

/**
 * A marker on a target, for example the comments on it. The host draws one
 * marker per presented row, combining the annotations of all its targets.
 */
export interface TargetAnnotation {
  target: ProjectionTarget
  /** For example the number of comments. */
  count?: number
  /** Short accessible description, for example `2 comments`. */
  label?: string
  tone?: AnnotationTone
}

const kinds = ['entity', 'relationship'] as const
const sides = ['before', 'after'] as const

/** Whether `value` is a well-formed `ProjectionTarget`. */
export function isProjectionTarget(value: unknown): value is ProjectionTarget {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const target = value as Record<string, unknown>
  if (Object.keys(target).some(key => !['kind', 'id', 'side', 'path'].includes(key))) return false
  return (
    kinds.includes(target.kind as ProjectionTarget['kind']) &&
    typeof target.id === 'string' &&
    target.id.length > 0 &&
    sides.includes(target.side as ProjectionTarget['side']) &&
    (target.path === undefined || isPropertyPath(target.path))
  )
}

/** Whether two targets are the same item on the same side and the same property (no `path` is the item itself). */
export function sameTarget(a: ProjectionTarget, b: ProjectionTarget): boolean {
  return a.kind === b.kind && a.id === b.id && a.side === b.side && (a.path ?? '') === (b.path ?? '')
}

export const collectionOf = (kind: ProjectionTarget['kind']) => (kind === 'entity' ? 'entities' : 'relationships')
const kindOf = (collection: Row['collection']): ProjectionTarget['kind'] => (collection === 'entities' ? 'entity' : 'relationship')

/** The targets a presented row stands for: its items on each side. */
export function rowTargets(row: Row, subject: ViewSubject): ProjectionTarget[] {
  const kind = kindOf(row.collection)
  if (subject.mode === 'extraction') return row.after.map(id => ({kind, id, side: 'after' as const}))
  return [...row.before.map(id => ({kind, id, side: 'before' as const})), ...row.after.map(id => ({kind, id, side: 'after' as const}))]
}

/** The extraction a target's side refers to, if the subject has it. */
export function targetExtraction(subject: ViewSubject, side: ProjectionTarget['side']): Extraction | undefined {
  if (subject.mode === 'extraction') return side === 'after' ? subject.extraction : undefined
  return side === 'before' ? subject.before : subject.after
}

/** The entity or relationship a target names, if it exists. */
export function targetItem(subject: ViewSubject, target: ProjectionTarget): Entity | Relationship | undefined {
  const extraction = targetExtraction(subject, target.side)
  return extraction ? (extraction[collectionOf(target.kind)] as (Entity | Relationship)[]).find(item => item.id === target.id) : undefined
}

/** Finds the row that presents a target in `rows` (from `subjectRows(subject)`). */
export function resolveTarget(subject: ViewSubject, rows: readonly Row[], target: ProjectionTarget): TargetResolution {
  if (!isProjectionTarget(target)) return {status: 'absent', reason: 'item'}
  if (subject.mode === 'extraction' && target.side === 'before') return {status: 'absent', reason: 'side'}
  const collection = collectionOf(target.kind)
  const row = rows.find(
    candidate =>
      candidate.collection === collection &&
      (subject.mode === 'extraction' || target.side === 'after' ? candidate.after : candidate.before).includes(target.id),
  )
  const item = targetItem(subject, target)
  if (!row || !item) return {status: 'absent', reason: 'item'}
  if (target.path !== undefined && readPointer(item.data ?? {}, target.path) === undefined) {
    return {status: 'absent', reason: 'property', rowId: row.id}
  }
  return {status: 'present', rowId: row.id}
}
