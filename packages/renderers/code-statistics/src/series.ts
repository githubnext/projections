import type {ChangeStatus as Status, Entity} from '@githubnext/projections-schemas'
import type {CodeStatisticsScope, EntityChange, StatisticsKey} from '@githubnext/projections-renderer-sdk/presentation'
import {statisticsCount} from '@githubnext/projections-renderer-sdk/presentation'
import {classifyChange} from '@githubnext/projections-renderer-kit'
import type {Category, ChangeClassification, Palette} from '@githubnext/projections-renderer-kit'
import type {ThemeTokenName} from '@githubnext/projections-renderer-sdk/protocol'
import type {CodeStatisticsMeasure, StatisticsMotion} from './timeline.js'

/** Composition splits every line into exactly one of these, so the parts sum to the whole. */
export const composition: {id: CodeStatisticsMeasure; label: string}[] = [
  {id: 'code', label: 'Code'},
  {id: 'comment', label: 'Comments'},
  {id: 'blank', label: 'Blank'},
]

/** The composition's parts take the first categorical tokens in order; the host's legend names the same tokens. */
const compositionTokens = ['chart-1', 'chart-2', 'chart-3'] as const

export interface Series {
  id: string
  label: string
  before: number
  after: number
  status: Status
  renamed?: boolean | undefined
  change: ChangeClassification
  /** The Before label in diff mode, when it differs from the one shown. */
  previousLabel?: string | undefined
  /** Whether the row addresses a presented entity and can therefore be inspected. */
  entity: boolean
  /** The count shown at this progress. */
  value: number
  size: number
  presence: number
  /** Strength of change decoration relative to the host's highlighting: an arriving row's grows with it. */
  emphasis: number
  color: string
  /** What `color` paints, for the host's legend: a language's color or a theme token. */
  swatch: {color: string} | {token: ThemeTokenName}
}

/** A language's count of `key` in `scope`; a missing measurement or side counts as 0. */
export function amount(entity: Entity | undefined, key: StatisticsKey, scope: CodeStatisticsScope): number {
  return statisticsCount(entity, key, scope) ?? 0
}

function label(change: EntityChange<Entity>, local: number): string {
  const entity = (local < 0.5 ? (change.before ?? change.after) : (change.after ?? change.before))!
  return entity.label ?? entity.id
}

/** A row's count at this progress: an absent side counts as 0. */
function interpolated(change: EntityChange<Entity>, key: StatisticsKey, scope: CodeStatisticsScope, motion: StatisticsMotion): number {
  const before = amount(change.before, key, scope)
  return before + (amount(change.after, key, scope) - before) * motion.mix
}

/** What every series is computed from: the tracked languages and their motion at this progress. */
export interface SeriesInput {
  tracked: readonly EntityChange<Entity>[]
  motions: ReadonlyMap<string, StatisticsMotion>
  /** A code-statistics measure, or `value` for generic measurements. */
  measure: StatisticsKey
  scope: CodeStatisticsScope
  diff: boolean
  palette: Palette
  categories: ReadonlyMap<string, Category>
}

/**
 * One row per language (or measured entity), largest first, in its Linguist or categorical color. A Files scope
 * (tests, or the rest) leaves out languages it counts nothing in at either revision, so a tests view lists only
 * languages with tests; the choice depends only on the two revisions, so rows hold through the transition.
 */
export function languageSeries({tracked, motions, measure, scope, diff, palette, categories}: SeriesInput): Series[] {
  return tracked
    .filter(change => scope === 'all' || amount(change.before, measure, scope) > 0 || amount(change.after, measure, scope) > 0)
    .map(change => {
      const motion = motions.get(change.id)!
      const shownLabel = label(change, motion.local)
      return {
        id: change.id,
        label: shownLabel,
        previousLabel:
          diff && change.before && change.after && (change.before.label ?? change.before.id) !== shownLabel
            ? (change.before.label ?? change.before.id)
            : undefined,
        before: amount(change.before, measure, scope),
        after: amount(change.after, measure, scope),
        status: change.status,
        renamed: change.renamed,
        change: classifyChange(change),
        entity: true,
        value: interpolated(change, measure, scope, motion),
        size: motion.size,
        presence: motion.opacity,
        emphasis: change.status === 'added' ? motion.mix : 1,
        color: '',
        swatch: {token: compositionTokens[0]} as Series['swatch'],
      }
    })
    .sort(
      (left, right) =>
        // Ranking on the larger of the two states is independent of progress, so
        // rows keep both their order and their colour for the whole transition.
        Math.max(right.before, right.after) - Math.max(left.before, left.after) || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    )
    .map(item => {
      // Languages take their GitHub Linguist color (the same as in file packing), other rows a categorical one.
      const entry = palette.entry(categories.get(item.id)!.key)!
      return {...item, color: entry.paint, swatch: entry.swatch}
    })
}

/** One row per line kind, summed over every language. */
export function compositionSeries({tracked, motions, scope}: Pick<SeriesInput, 'tracked' | 'motions' | 'scope'>): Series[] {
  return composition.map((part, index) => {
    const before = tracked.reduce((sum, change) => sum + amount(change.before, part.id, scope), 0)
    const after = tracked.reduce((sum, change) => sum + amount(change.after, part.id, scope), 0)
    return {
      id: `composition:${part.id}`,
      label: part.label,
      before,
      after,
      status: (before === after ? 'unchanged' : 'modified') as Status,
      change: (before === after ? 'unchanged' : 'modified') as ChangeClassification,
      // Each language contributes its own step's count, so the composition follows the steps too.
      value: tracked.reduce((sum, change) => sum + interpolated(change, part.id, scope, motions.get(change.id)!), 0),
      entity: false,
      size: 1,
      presence: 1,
      emphasis: 1,
      color: `var(--projections-${compositionTokens[index]!})`,
      swatch: {token: compositionTokens[index]!},
    }
  })
}
