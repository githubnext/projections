// Count figures: how many items of an extraction kind there are.
import {rendererLimits} from '../frame.js'
import {keys} from '../validation.js'
import {summaryChanges, summaryCount, summaryNoun, type Fields, type SummaryNoun} from './figure.js'

/**
 * A count figure of the summary bar the host draws along every projection view: how many items of an extraction
 * `kind` (entity or relationship) there are, in the renderer's own word for them. `count` is the total in the
 * extraction, or in `after` for a comparison; `added`, `removed` and `modified` count the comparison's changes of that
 * status whose item has the kind (an added or modified change by its `after` item, a removed one by its `before` item),
 * and are omitted for one extraction. The previous total ("was N") is `count − added + removed`, so it is never sent.
 * `collection` tells an entity kind from a relationship kind of the same name. Hosts show their own counts of the
 * named kinds, so the counts are what the renderer checks verify; the vocabulary, and which kinds appear in what
 * order, are the renderer's. `type` is optional and defaults to `count`.
 */
export interface SummaryCountItem {
  /** Marks a count figure; the default when absent. */
  type?: 'count'
  /** Which items `kind` names: entities or relationships. Absent, both (a kind that names either). */
  collection?: 'entities' | 'relationships'
  /** The extraction kind counted, 1 to `rendererLimits.summaryKind` characters; each kind once per collection. */
  kind: string
  /** The renderer's word for items of the kind. */
  noun: SummaryNoun
  /** Items of the kind in the extraction, or in `after` for a comparison; a non-negative integer. */
  count: number
  /** In a comparison, added items of the kind (by their `after` item). */
  added?: number
  /** In a comparison, removed items of the kind (by their `before` item). */
  removed?: number
  /** In a comparison, modified items of the kind (by their `after` item). */
  modified?: number
}

/** The kinds counted so far, by the collection they were counted in (`both` once a bare kind or either collection). */
export type CountedKinds = Map<string, 'entities' | 'relationships' | 'both'>

/** Validates a count item whose kind `kinds` hasn't counted yet in its collection. */
export function parseCountItem(item: Fields, kinds: CountedKinds): SummaryCountItem | undefined {
  if (!keys(item, ['type', 'collection', 'kind', 'noun', 'count', 'added', 'removed', 'modified'])) return undefined
  const {collection, kind} = item
  if (typeof kind !== 'string' || !kind || kind.length > rendererLimits.summaryKind) return undefined
  if (collection !== undefined && collection !== 'entities' && collection !== 'relationships') return undefined
  const seen = kinds.get(kind)
  if (seen && (seen === 'both' || collection === undefined || seen === collection)) return undefined
  const noun = summaryNoun(item.noun)
  if (!noun || !summaryCount(item.count)) return undefined
  const deltas = summaryChanges(item)
  if (!deltas) return undefined
  return {
    ...(item.type === 'count' ? {type: 'count' as const} : {}),
    ...(collection === undefined ? {} : {collection}),
    kind,
    noun,
    count: item.count,
    ...deltas,
  }
}
