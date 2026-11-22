import type {ChangeStatus, Entity, Relationship} from '@githubnext/projections-schemas'
import {type EntityChange, type ScheduledStep, emphasisRise} from '@githubnext/projections-renderer-sdk/presentation'
import {unitProgress} from './motion.js'
import type {IconName} from '@githubnext/projections-renderer-sdk/protocol'

/** Identity change and content change are orthogonal; presentation folds them into one label. */
export type ChangeClassification = ChangeStatus | 'renamed'

/** The word for each change, in sentence case, as status text and accessible names say it (`Added`, `Renamed`). */
export const statusLabels: Record<ChangeClassification, string> = {
  added: 'Added',
  removed: 'Removed',
  modified: 'Modified',
  renamed: 'Renamed',
  unchanged: 'Unchanged',
}

interface Classifiable {
  status: ChangeStatus
  renamed?: boolean | undefined
  /** The comparison's volatile values (`change.varied`); within tolerance only, an item stays unchanged. */
  varied?: EntityChange<unknown>['varied'] | undefined
}

/**
 * The one change a row presents: its status, except that a renamed row whose content is unchanged is `renamed`. A
 * renamed and otherwise changed row keeps its status (see `describeChange` and `statusParts` for both).
 */
export function classifyChange(change: Classifiable): ChangeClassification {
  return change.renamed && change.status === 'unchanged' ? 'renamed' : change.status
}

/**
 * Whether a row changed in two ways, renamed and changed: no one hue is right for it, so a card draws it neutral and
 * each status word in its own hue (`pk-mixed-change`), never one change color inside another.
 */
export function mixedChange(change: Classifiable): boolean {
  return Boolean(change.renamed) && change.status !== 'unchanged'
}

/** A change in words for titles and accessible names: its label, or both for a renamed and changed row. */
export function describeChange(change: Classifiable): string {
  return change.renamed && change.status !== 'unchanged'
    ? `${statusLabels.renamed} and ${statusLabels[change.status].toLowerCase()}`
    : statusLabels[classifyChange(change)]
}

/**
 * Text glyphs for each change (`+` added, `−` removed, `~` modified, `→`
 * renamed), for plain-text contexts such as titles and the host's text view.
 * Rendered status draws `statusIcons` instead, always beside the word.
 */
export const statusGlyphs: Record<ChangeClassification, string> = {
  added: '+',
  removed: '−',
  modified: '~',
  renamed: '→',
  unchanged: '',
}

/** The icon that accompanies each change's word (see `Icon`). */
export const statusIcons: Record<Exclude<ChangeClassification, 'unchanged'>, IconName> = {
  added: 'added',
  removed: 'removed',
  modified: 'modified',
  renamed: 'renamed',
}

/**
 * One icon-and-word part of a change's status. `status` chooses the change
 * color; a renderer may word a domain's changes its own way (`−/+ Replace`)
 * as long as glyph and word say what the color says.
 */
export interface StatusPart {
  /** The change this part stands for, which chooses its color. */
  status: ChangeClassification
  /** The part as a text glyph, for plain-text contexts (titles, keys); rendered status shows `icon`. */
  glyph: string
  /** The icon drawn beside the word (see `Icon`). */
  icon: IconName
  /** The word, in sentence case (`Added`, or a domain's own such as `Replace`). */
  label: string
}

/** A change's status as glyph-and-word parts: one, or two for a renamed and otherwise changed item. */
export function statusParts(change: Classifiable): StatusPart[] {
  const part = (status: Exclude<ChangeClassification, 'unchanged'>) => ({
    status,
    glyph: statusGlyphs[status],
    icon: statusIcons[status],
    label: statusLabels[status],
  })
  if (!isChanged(change)) return []
  const status = classifyChange(change)
  return change.renamed && change.status !== 'unchanged'
    ? [part('renamed'), part(change.status)]
    : status === 'unchanged'
      ? []
      : [part(status)]
}

/** Whether a row carries a change worth emphasizing. */
export function isChanged(change: Classifiable): boolean {
  return change.status !== 'unchanged' || Boolean(change.renamed)
}

/**
 * How strongly to emphasize a change, ignoring steps: the host's
 * `highlighting` for changed rows, 0 for everything else. Highlighting is
 * exactly 0 at both endpoints, so nothing looks changed there. Renderers use
 * the step-scoped `RendererProps.emphasis` (see `stepEmphasis`) instead.
 */
export function presentedEmphasis(change: Classifiable, highlighting: number): number {
  if (!isChanged(change) || !Number.isFinite(highlighting)) return 0
  return Math.max(0, Math.min(1, highlighting))
}

const edgeColors: Record<ChangeClassification, string> = {
  added: 'var(--green)',
  removed: 'var(--red)',
  modified: 'var(--amber)',
  renamed: 'var(--violet)',
  unchanged: 'var(--edge)',
}

/**
 * Explicit stroke paint for a relationship, blended toward its change color by
 * emphasis. `weight` is the line's weight relative to the host's border width
 * (the kit's `--stroke`); emphasis thickens it toward the thick border width.
 * `base` is its paint without emphasis (the kit's edge color by default).
 */
export function edgePaint(
  change: Classifiable,
  emphasis: number,
  weight: number,
  base = 'var(--edge)',
): {stroke: string; strokeWidth: string} {
  if (emphasis <= 0.01) return {stroke: base, strokeWidth: `calc(var(--stroke) * ${weight})`}
  const strength = Math.round(emphasis * 100)
  return {
    stroke: `color-mix(in srgb, ${base} ${100 - strength}%, ${edgeColors[classifyChange(change)]} ${strength}%)`,
    strokeWidth: `calc(var(--stroke) * ${weight} + (var(--stroke-strong) - var(--stroke)) * ${Math.round(emphasis * 1000) / 1000})`,
  }
}

/** The version of a row a viewer should read at this point: before until halfway, then after. */
export function current<T>(change: EntityChange<T>, progress: number): T {
  return (progress < 0.5 ? (change.before ?? change.after) : (change.after ?? change.before))!
}

/** Linear presence for renderers without staged timing: arrivals fade in, departures out. */
export function entityPresence(change: EntityChange<unknown>, progress: number): number {
  const t = unitProgress(progress)
  return change.before ? (change.after ? 1 : 1 - t) : t
}

/** A numeric `data` field interpolated between versions; a missing side counts as 0. */
export function numericValue(change: EntityChange<Entity>, key: string, progress: number): number {
  const before = change.before?.data?.[key]
  const after = change.after?.data?.[key]
  const a = typeof before === 'number' ? before : 0
  const b = typeof after === 'number' ? after : 0
  return a + (b - a) * unitProgress(progress)
}

/** Whether either version of the row has one of `kinds`, so a row that changed kind matches both. */
export function isKind(change: EntityChange<Entity>, ...kinds: string[]): boolean {
  return kinds.includes(change.before?.kind ?? '') || kinds.includes(change.after?.kind ?? '')
}

/** A relationship row's kind: After's, or Before's for a removed relationship. */
export function edgeKind(edge: EntityChange<Relationship>): string {
  return (edge.after ?? edge.before!).kind
}

/** Whether a relationship is present at this point, so lists match the timeline. */
export function edgePresence(edge: EntityChange<Relationship>, progress: number): number {
  return entityPresence(edge, progress)
}

/** Step-scoped emphasis for one row: pass the row, and its row ID when the row object has none. */
export type EmphasisOf = (change: Classifiable & {id?: string}, id?: string) => number

/**
 * Change emphasis scoped to each change's own comparison step: a change shows
 * none of the host's highlighting until its step's window begins (in the
 * direction the schedule is travelled, so an explicit reverse order mirrors
 * it), rises over the start of the window, then follows the host's
 * highlighting, which is exactly 0 at both endpoints. Earlier steps never
 * pre-tint later changes. Rows no step places use the host's highlighting.
 * A held pane of side by side or swipe (`pane`) is a static comparison, not a
 * moment of the transition: every change it shows follows the host's
 * highlighting alike, so Before marks its removals as After marks its
 * additions.
 */
export function stepEmphasis(
  schedule: readonly ScheduledStep[],
  progress: number,
  highlighting: number,
  pane?: 'before' | 'after',
): EmphasisOf {
  const stepOf = new Map<string, ScheduledStep>()
  if (!pane) for (const step of schedule) for (const id of [...step.entities, ...step.relationships]) stepOf.set(id, step)
  return (change, id = change.id) => {
    const strength = presentedEmphasis(change, highlighting)
    return strength && id !== undefined ? strength * emphasisRise(stepOf.get(id), progress) : strength
  }
}
