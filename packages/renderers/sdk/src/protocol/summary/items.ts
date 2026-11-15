// The summary a renderer sends for the host's summary bar.
import {rendererLimits} from '../frame.js'
import {record} from '../validation.js'
import {parseCountItem, type CountedKinds, type SummaryCountItem} from './count.js'
import {parseFactItem, type SummaryFactItem} from './fact.js'

/**
 * One figure of the summary bar: a count of an extraction kind (`type: 'count'`, the default) or a domain fact
 * (`type: 'fact'`). Hosts drop an item of a `type` they don't know, keeping the rest, so new types stay additive.
 */
export type SummaryItem = SummaryCountItem | SummaryFactItem

/** A renderer's summary: its figures in display order; no items returns the bar to the host's own words. */
export interface RendererSummary {
  /** The figures, at most `rendererLimits.summaryItems`, in the order the bar shows them. */
  items: SummaryItem[]
}

/**
 * Validates a summary's figures strictly (the `items` of a `summary` message): at most `rendererLimits.summaryItems`.
 * A count item (`type` `count` or absent) names a non-empty `kind` once per collection (`collection`, optional); a
 * fact item (`type` `fact`) has a distinct non-empty `id`, an optional `icon` name, an optional `tone`, at most
 * `rendererLimits.summaryFactIds` non-empty `ids`, optional `added`, `removed` and `modified` counts and an optional
 * `description` (non-empty, at most `rendererLimits.summaryDescription` characters). Both have a `noun` of exactly
 * `singular` and `plural` (non-empty, at most `rendererLimits.summaryNoun` characters) and non-negative integer
 * counts. An item of an unknown `type` is dropped and the rest kept, so later types stay additive; anything else
 * invalid refuses the whole summary.
 */
export function parseSummaryItems(value: unknown): SummaryItem[] | undefined {
  if (!Array.isArray(value) || value.length > rendererLimits.summaryItems) return undefined
  const kinds: CountedKinds = new Map()
  const facts = new Set<string>()
  const items: SummaryItem[] = []
  for (const item of value as unknown[]) {
    if (!record(item)) return undefined
    if (item.type === 'fact') {
      const fact = parseFactItem(item, facts)
      if (!fact) return undefined
      facts.add(fact.id)
      items.push(fact)
      continue
    }
    if (item.type !== undefined && item.type !== 'count') {
      if (typeof item.type !== 'string') return undefined
      continue
    }
    const count = parseCountItem(item, kinds)
    if (!count) return undefined
    const seen = kinds.get(count.kind)
    kinds.set(count.kind, seen ? 'both' : (count.collection ?? 'both'))
    items.push(count)
  }
  return items
}
