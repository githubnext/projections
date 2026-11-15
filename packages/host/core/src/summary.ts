import {useLayoutEffect, useState} from 'react'
import type {RefObject} from 'react'
import {summaryCounts, summaryDeltas, summaryItems, summarySentence} from '@githubnext/projections-renderer-sdk/presentation'
import type {SummaryCount, SummaryDelta} from '@githubnext/projections-renderer-sdk/presentation'
import type {SummaryFactTone, SummaryItem, SummaryNoun} from '@githubnext/projections-renderer-sdk/protocol'
import type {Row, ViewSubject} from './model.js'

/** An extraction kind a summary figure counts; without `collection`, the kind in both. */
export interface SummaryKind {
  collection?: 'entities' | 'relationships'
  kind: string
}

/**
 * One figure of the summary bar. A `count` figure: a noun of the renderer's domain (or the host's word for a kind),
 * the kinds it counts, their total (in `after` for a comparison) and, for a comparison, their changes by status,
 * counted by the host from the subject (only the words and order come from the renderer). A `fact` figure: a finding
 * the renderer reports (`SummaryFactItem`), its count and changes as sent, with its `icon`, `tone`, `description` and
 * the item `ids` it filters to.
 */
export interface SummaryFigure {
  type: 'count' | 'fact'
  /** Stable key: a count's plural noun, lowercased; `fact:<id>` for a fact. */
  key: string
  noun: SummaryNoun
  /** The kinds a count figure counts; none for a fact. */
  kinds: SummaryKind[]
  count: number
  added: number
  removed: number
  modified: number
  /** A fact's icon token name (`--projections-icon-<name>`). */
  icon?: string
  /** A fact's tone. */
  tone?: SummaryFactTone
  /** The item IDs a fact filters to; without them it is not a filter. */
  ids?: string[]
  /** A fact's sentence of context, for its tooltip and accessible description. */
  description?: string
}

/**
 * The summary bar's filter: the items of a count figure's kinds (or only those with one change status), or the items
 * a fact names (`ids`, matched against a row's own ID and the item IDs it presents on either side).
 */
export interface SummaryFilter {
  kinds: SummaryKind[]
  ids?: string[]
  status?: SummaryDelta
}

const matchesKind = (counted: SummaryCount, kind: SummaryKind) =>
  counted.kind === kind.kind && (kind.collection === undefined || counted.collection === kind.collection)

/**
 * The summary bar's figures for a subject: the renderer's `items` (its words, order and kinds) when it sent any, else
 * every kind in the host's words (`humanizeKind`). Counts are always the host's own (`summaryCounts`), whatever the
 * renderer reported. Figures with the same noun are one figure, so a renderer may name several kinds alike.
 */
export function summaryFigures(subject: ViewSubject, items?: readonly SummaryItem[]): SummaryFigure[] {
  const counts = summaryCounts(subject)
  const named = items?.length ? items : summaryItems(subject)
  const figures = new Map<string, SummaryFigure>()
  for (const item of named) {
    if (item.type === 'fact') {
      figures.set(`fact:${item.id}`, {
        type: 'fact',
        key: `fact:${item.id}`,
        noun: item.noun,
        kinds: [],
        count: item.count,
        added: item.added ?? 0,
        removed: item.removed ?? 0,
        modified: item.modified ?? 0,
        ...(item.icon ? {icon: item.icon} : {}),
        ...(item.tone ? {tone: item.tone} : {}),
        ...(item.ids ? {ids: item.ids} : {}),
        ...(item.description ? {description: item.description} : {}),
      })
      continue
    }
    const kind: SummaryKind = {...(item.collection ? {collection: item.collection} : {}), kind: item.kind}
    const matched = counts.filter(counted => matchesKind(counted, kind))
    if (!matched.length) continue
    const key = item.noun.plural.toLocaleLowerCase()
    let figure = figures.get(key)
    if (!figure) figures.set(key, (figure = {type: 'count', key, noun: item.noun, kinds: [], count: 0, added: 0, removed: 0, modified: 0}))
    figure.kinds.push(kind)
    for (const counted of matched) {
      figure.count += counted.count
      for (const delta of summaryDeltas) figure[delta] += counted[delta] ?? 0
    }
  }
  return [...figures.values()]
}

/** Whether a row is one of a filter's items. */
export function rowInSummary(row: Row, filter: SummaryFilter): boolean {
  if (filter.status !== undefined && row.status !== filter.status) return false
  if (filter.ids) return filter.ids.some(id => row.id === id || row.before.includes(id) || row.after.includes(id))
  return filter.kinds.some(kind => row.kind === kind.kind && (kind.collection === undefined || row.collection === kind.collection))
}

/** Whether a figure filters: every count figure, and a fact that names its items. */
export function summaryFilterable(figure: SummaryFigure): boolean {
  return figure.type === 'count' || Boolean(figure.ids?.length)
}

/** The filter a figure's total (`status` omitted) or one of its change counts applies; a fact's is its `ids`. */
export function summaryFilterOf(figure: SummaryFigure, status?: SummaryDelta): SummaryFilter {
  if (figure.type === 'fact') return {kinds: [], ids: figure.ids ?? []}
  return {kinds: figure.kinds, ...(status ? {status} : {})}
}

/** Whether two summary filters show the same items. */
export function sameSummaryFilter(a: SummaryFilter | null | undefined, b: SummaryFilter | null | undefined): boolean {
  if (!a || !b) return a === b
  const kinds = (filter: SummaryFilter) =>
    filter.kinds
      .map(kind => `${kind.collection ?? '*'}:${kind.kind}`)
      .sort()
      .join('\n')
  const ids = (filter: SummaryFilter) => (filter.ids ? [...filter.ids].sort().join('\n') : undefined)
  return a.status === b.status && kinds(a) === kinds(b) && ids(a) === ids(b)
}

/**
 * The figures as the summary bar's one sentence (`12 workspaces +1 −1 · 18 dependencies +2 · 1 newly enforced`), for
 * text and labels: counts and facts alike, each with its changes in a comparison.
 */
export function figuresSentence(figures: readonly SummaryFigure[], comparing: boolean, locale?: string): string {
  return summarySentence(
    figures.map(figure => (comparing ? figure : {noun: figure.noun, count: figure.count})),
    locale,
  )
}

/**
 * How many figures fit inline: all of them when their widths fit `available`, else as many from the start as fit
 * beside the overflow button (`more` wide), which lists the rest. Never negative.
 */
export function fitSummary(widths: readonly number[], available: number, more: number): number {
  const total = widths.reduce((sum, width) => sum + width, 0)
  if (total <= available) return widths.length
  let used = more
  let shown = 0
  for (const width of widths) {
    if (used + width > available) break
    used += width
    shown++
  }
  return shown
}

/**
 * Follows how many summary figures fit in a bar (`fitSummary`) as it resizes. The bar draws every figure once more in
 * a hidden measuring row: elements marked `data-summary-measure` holding one `data-summary-figure` per figure, in
 * order, and a `data-summary-more` button. Content marked `data-summary-fixed` (such as the varied toggle) always
 * stays in the bar and takes its room first. `key` changes whenever the figures' text does.
 */
export function useSummaryFit(bar: RefObject<HTMLElement | null>, count: number, key: string): number {
  const [shown, setShown] = useState(count)
  useLayoutEffect(() => {
    const element = bar.current
    if (!element) return
    const measure = () => {
      const row = element.querySelector('[data-summary-measure]')
      const figures = row ? [...row.querySelectorAll<HTMLElement>('[data-summary-figure]')] : []
      const more = row?.querySelector<HTMLElement>('[data-summary-more]')?.getBoundingClientRect().width ?? 24
      const style = element.ownerDocument.defaultView?.getComputedStyle(element)
      const padding = style ? parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) : 0
      const gap = style ? parseFloat(style.columnGap) || 0 : 0
      const fixed = [...element.querySelectorAll<HTMLElement>('[data-summary-fixed]')].reduce(
        (sum, item) => sum + item.getBoundingClientRect().width + gap,
        0,
      )
      const available = element.clientWidth - padding - fixed
      setShown(
        fitSummary(
          figures.map(figure => figure.getBoundingClientRect().width),
          available,
          more + gap,
        ),
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [bar, count, key])
  return Math.min(shown, count)
}
