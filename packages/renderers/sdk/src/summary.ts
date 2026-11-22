import type {Comparison, Entity, Extraction, Relationship} from '@githubnext/projections-schemas'
import {rendererLimits, type SummaryCountItem, type SummaryNoun} from './protocol.js'
import {humanizeKind} from './kind-nouns.js'

export {adjectivalKind, humanizeKind, kindWords, pluralWord, sentenceCase} from './kind-nouns.js'

/** What a summary counts: one extraction, or a comparison of two (the shape of `InitPayload` and the host's subject). */
export type SummarySubject =
  | {mode: 'extraction'; extraction: Extraction}
  | {mode: 'comparison'; before: Extraction; after: Extraction; comparison: Comparison}

/** The change statuses a summary counts per kind. */
export const summaryDeltas = ['added', 'removed', 'modified'] as const
/** One of `summaryDeltas`. */
export type SummaryDelta = (typeof summaryDeltas)[number]

/** The counts of one extraction kind in one collection: its total (in `after` for a comparison) and, for a comparison, its changes by status. */
export interface SummaryCount {
  /** Whether `kind` names entities or relationships. */
  collection: 'entities' | 'relationships'
  /** The extraction kind, as the extraction spells it. */
  kind: string
  /** Items of the kind in the extraction, or in `after` for a comparison. */
  count: number
  /** For a comparison, added items of the kind (by their `after` item). */
  added?: number
  /** For a comparison, removed items of the kind (by their `before` item). */
  removed?: number
  /** For a comparison, modified items of the kind (by their `after` item). */
  modified?: number
}

/**
 * A renderer's words for kinds: a noun per kind, or `false` to leave a kind out of the summary. A key may name one
 * collection's kind (`relationships:index`), which wins over the bare kind. As an object, the kinds it lists come
 * first, in its order; as a function (given the kind and its collection), `undefined` keeps the host's words.
 */
export type SummaryNouns =
  | Readonly<Record<string, SummaryNoun | false>>
  | ((kind: string, collection: 'entities' | 'relationships') => SummaryNoun | false | undefined)

type Collection = 'entities' | 'relationships'

/**
 * Counts each extraction kind of a subject, per collection: its items in the extraction, or in `after` for a
 * comparison, and for a comparison its changes by status (an added or modified change by its `after` item's kind, a
 * removed one by its `before` item's). Kinds come in the order a summary shows them by default: entity kinds, then
 * relationship kinds, each by count (largest first), then name. A kind only `before` has is counted with a total of 0.
 */
export function summaryCounts(subject: SummarySubject): SummaryCount[] {
  const counts = new Map<string, SummaryCount>()
  const entry = (kind: string, collection: Collection) => {
    const key = `${collection}:${kind}`
    let found = counts.get(key)
    if (!found) counts.set(key, (found = {collection, kind, count: 0}))
    return found
  }
  const total = (extraction: Extraction) => {
    for (const collection of ['entities', 'relationships'] as const) {
      for (const item of extraction[collection] as (Entity | Relationship)[]) entry(item.kind, collection).count++
    }
  }
  if (subject.mode === 'extraction') total(subject.extraction)
  else {
    const {before, after, comparison} = subject
    total(after)
    const index = (extraction: Extraction) => ({
      entities: new Map<string, Entity | Relationship>(extraction.entities.map(item => [item.id, item])),
      relationships: new Map<string, Entity | Relationship>(extraction.relationships.map(item => [item.id, item])),
    })
    const sides = {before: index(before), after: index(after)}
    for (const collection of ['entities', 'relationships'] as const) {
      for (const item of before[collection] as (Entity | Relationship)[]) entry(item.kind, collection)
    }
    for (const change of comparison.changes) {
      if (change.status === 'unchanged') continue
      const side = change.status === 'removed' || change.after[0] === undefined ? 'before' : 'after'
      const id = side === 'before' ? change.before[0] : change.after[0]
      const item = id === undefined ? undefined : sides[side][change.collection].get(id)
      if (!item) continue
      const found = entry(item.kind, change.collection)
      found[change.status] = (found[change.status] ?? 0) + 1
    }
  }
  const order = (collection: Collection) =>
    [...counts.values()]
      .filter(item => item.collection === collection)
      .toSorted((a, b) => b.count - a.count || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0))
  return [...order('entities'), ...order('relationships')]
}

const clip = (text: string) => (text.length <= rendererLimits.summaryNoun ? text : `${text.slice(0, rendererLimits.summaryNoun - 1)}…`)

/**
 * A subject's summary, as a renderer posts it: a count figure (`type: 'count'`) per kind and collection (`summaryCounts`), worded with `nouns` where it gives
 * a noun and the host's words (`humanizeKind`) otherwise, leaving out the kinds it maps to `false`. The kinds an
 * object of nouns lists come first, in its order. At most `rendererLimits.summaryItems` figures.
 */
export function summaryItems(subject: SummarySubject, nouns?: SummaryNouns): SummaryCountItem[] {
  const counts = summaryCounts(subject)
  const own = (key: string) => (nouns && typeof nouns === 'object' && Object.hasOwn(nouns, key) ? nouns[key] : undefined)
  const lookup = (count: SummaryCount) =>
    typeof nouns === 'function' ? nouns(count.kind, count.collection) : (own(`${count.collection}:${count.kind}`) ?? own(count.kind))
  if (nouns && typeof nouns === 'object') {
    const listed = Object.keys(nouns)
    const rank = (count: SummaryCount) => {
      const at = [listed.indexOf(`${count.collection}:${count.kind}`), listed.indexOf(count.kind)].find(index => index >= 0)
      return at ?? listed.length
    }
    counts.sort((a, b) => rank(a) - rank(b))
  }
  const items: SummaryCountItem[] = []
  for (const count of counts) {
    const noun = lookup(count)
    if (noun === false || count.kind.length > rendererLimits.summaryKind) continue
    const words = noun ?? humanizeKind(count.kind)
    items.push({type: 'count', ...count, noun: {singular: clip(words.singular), plural: clip(words.plural)}})
    if (items.length === rendererLimits.summaryItems) break
  }
  return items
}

/** A figure's total in words, in the locale's digits: `1 workspace`, `12 workspaces`. */
export function summaryCountText(count: number, noun: SummaryNoun, locale?: string): string {
  return `${count.toLocaleString(locale)} ${count === 1 ? noun.singular : noun.plural}`
}

/** A change count as a summary bar shows it: `+2` added, `−1` removed (a minus sign), `~3` modified. */
export function summaryDeltaText(delta: SummaryDelta, count: number, locale?: string): string {
  return `${delta === 'added' ? '+' : delta === 'removed' ? '\u2212' : '~'}${count.toLocaleString(locale)}`
}

/** A change count in words, for accessible names: `2 added`, `1 removed`, `3 modified`. */
export function summaryDeltaWords(delta: SummaryDelta, count: number, locale?: string): string {
  return `${count.toLocaleString(locale)} ${delta}`
}

/**
 * The summary as one sentence, the same words the summary bar shows: `12 workspaces · 18 dependencies` for one
 * revision, `12 workspaces +1 −1 · 18 dependencies +2` for a comparison (changes that didn't happen are left out).
 */
export function summarySentence(
  items: readonly {
    noun: SummaryNoun
    count: number
    added?: number | undefined
    removed?: number | undefined
    modified?: number | undefined
  }[],
  locale?: string,
): string {
  return items
    .map(item =>
      [
        summaryCountText(item.count, item.noun, locale),
        ...summaryDeltas.filter(delta => (item[delta] ?? 0) > 0).map(delta => summaryDeltaText(delta, item[delta]!, locale)),
      ].join(' '),
    )
    .join(' · ')
}
