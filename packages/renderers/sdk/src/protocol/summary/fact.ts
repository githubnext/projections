// Fact figures: findings of the renderer's domain that no kind count says.
import {rendererLimits} from '../frame.js'
import {text, keys, label} from '../validation.js'
import {summaryChanges, summaryCount, summaryNoun, type Fields, type SummaryNoun} from './figure.js'

/** The tones a summary fact may take: a change hue on its figure, or none. */
export const summaryFactTones = ['added', 'removed', 'modified', 'neutral'] as const
/** One of `summaryFactTones`: the change color of a fact's figure, or `neutral` for none. */
export type SummaryFactTone = (typeof summaryFactTones)[number]

/**
 * A fact figure of the summary bar: a finding of the renderer's domain that no kind count says, such as `2 breaking
 * changes` or `3 unprotected routes`. `id` is its stable key; `icon` names a theme icon token (`--projections-icon-<name>`,
 * none without it); `count` and `noun` are its words (singular for 1); `tone` colors the figure. With `ids`, the
 * entity or relationship IDs (or comparison change IDs) it is about, the figure filters to those items as a count
 * figure filters to its kind. In a comparison, `added`, `removed` and `modified` are its changes, which hosts draw
 * after it in the change colors as they draw a count figure's: how many of the things it counts arrived, left or
 * changed, or for a measure of each revision (`39,882 lines of code`) its net change, `added` when it grew and
 * `removed` when it shrank, so the previous value is `count − added + removed` as for a count. `description` is one
 * sentence of context hosts show as its tooltip and accessible description, such as the rules that decided it.
 * Hosts show a fact as the renderer sends it; the renderer checks verify its shape, that its `ids` exist and that a
 * single extraction's facts have no changes.
 */
export interface SummaryFactItem {
  /** Marks a fact figure. */
  type: 'fact'
  /** Stable key, distinct among the summary's facts, 1 to `rendererLimits.summaryKind` characters. */
  id: string
  /** A theme icon token's name without its `icon-` prefix: a lowercase identifier; no icon when absent. */
  icon?: string
  /** The figure's number, a non-negative integer. */
  count: number
  /** The figure's words; `singular` for a `count` of 1, else `plural`. */
  noun: SummaryNoun
  /** The figure's change color; absent or `neutral`, none. */
  tone?: SummaryFactTone
  /** The items the fact is about, at most `rendererLimits.summaryFactIds`; activating the figure filters to them. */
  ids?: string[]
  /** In a comparison, how many of the counted things arrived, or a measure's net growth. */
  added?: number
  /** In a comparison, how many of the counted things left, or a measure's net shrinkage. */
  removed?: number
  /** In a comparison, how many of the counted things changed. */
  modified?: number
  /** One sentence of context, at most `rendererLimits.summaryDescription` characters, shown as the figure's tooltip. */
  description?: string
}

const summaryIconPattern = /^[a-z][a-z0-9-]{0,63}$/u

/** Validates a fact item whose ID isn't among `facts`. */
export function parseFactItem(item: Fields, facts: ReadonlySet<string>): SummaryFactItem | undefined {
  if (!keys(item, ['type', 'id', 'icon', 'count', 'noun', 'tone', 'ids', 'added', 'removed', 'modified', 'description'])) return undefined
  const {id, icon, tone, ids, description} = item
  if (typeof id !== 'string' || !id || id.length > rendererLimits.summaryKind || facts.has(id)) return undefined
  if (icon !== undefined && !(typeof icon === 'string' && summaryIconPattern.test(icon))) return undefined
  if (tone !== undefined && !summaryFactTones.includes(tone as SummaryFactTone)) return undefined
  if (
    ids !== undefined &&
    !(Array.isArray(ids) && ids.length <= rendererLimits.summaryFactIds && ids.every(entry => text(entry) && entry.length > 0))
  ) {
    return undefined
  }
  if (description !== undefined && !label(description, rendererLimits.summaryDescription)) return undefined
  const noun = summaryNoun(item.noun)
  const deltas = summaryChanges(item)
  if (!noun || !summaryCount(item.count) || !deltas) return undefined
  return {
    type: 'fact',
    id,
    ...(icon === undefined ? {} : {icon: icon as string}),
    count: item.count,
    noun,
    ...(tone === undefined ? {} : {tone: tone as SummaryFactTone}),
    ...(ids === undefined ? {} : {ids: [...(ids as string[])]}),
    ...deltas,
    ...(description === undefined ? {} : {description: description as string}),
  }
}
