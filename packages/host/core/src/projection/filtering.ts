import {useState} from 'react'
import {changeContext, isScopeChange, regenerated, variedWithinTolerance} from '@githubnext/projections-renderer-sdk/presentation'
import type {ViewScope} from '@githubnext/projections-renderer-sdk/presentation'
import {humanizeKind} from '@githubnext/projections-renderer-sdk/presentation'
import {rendererLimits} from '@githubnext/projections-renderer-sdk/protocol'
import type {FilterPayload, SummaryNoun} from '@githubnext/projections-renderer-sdk/protocol'
import type {Row, ViewSubject} from '../model.js'
import {rowInSummary} from '../summary.js'
import type {SummaryFigure} from '../summary.js'
import type {RequestChange, ValueOf} from './controllable.js'
import {memo} from './memo.js'
import type {ProjectionController} from './types.js'

function matches(row: Row, query: string): boolean {
  return !query || `${row.id} ${row.label} ${row.kind} ${row.summary ?? ''}`.toLocaleLowerCase().includes(query)
}

/**
 * The scope and filters in effect. The scope is the noise (varied only, regenerated only, or both) or the changes
 * (`changesOnly`), else everything; the noise wins when an embedder sets both. The summary filter and find narrow
 * within the scope.
 */
export function filterState(comparing: boolean, value: ValueOf) {
  const variedOnly = comparing && value('variedOnly')
  const regeneratedOnly = comparing && value('regeneratedOnly')
  const noise = variedOnly || regeneratedOnly
  const changesOnly = comparing && !noise && value('changesOnly')
  const scope: ViewScope = noise ? 'noise' : changesOnly ? 'changes' : 'all'
  return {scope, variedOnly, regeneratedOnly, summaryFilter: value('summaryFilter') ?? null, changesOnly, search: value('search')}
}

export type FilterState = ReturnType<typeof filterState>

/**
 * How many items each scope holds: the changes (without their context), every item, and the noise; and how many items
 * the Changes scope leaves out (`hidden`), none when every item is a change or gives one context.
 */
export interface ScopeCounts {
  changes: number
  all: number
  noise: number
  hidden: number
}

/** Items the Changes scope leaves out, by the summary bar's noun for them (`12 tables`). */
export interface ScopeHidden {
  noun: SummaryNoun
  count: number
}

/** Whether a row is in the scope, before the summary filter and find narrow it. */
function inScope(row: Row, scope: ViewScope, variedOnly: boolean, regeneratedOnly: boolean): boolean {
  if (scope === 'changes') return isScopeChange(row)
  if (scope === 'noise') return (variedOnly && variedWithinTolerance(row)) || (regeneratedOnly && regenerated(row))
  return true
}

/** What the scope and filters keep (see `createRowFilter`). */
export interface RowFilter {
  visibleRows: readonly Row[]
  filter: FilterPayload
  counts: ScopeCounts
  hidden: ScopeHidden[]
}

/**
 * The rows the scope and filters keep, the filter payload renderers apply, and each scope's count, as a selector that
 * recomputes each part only when its inputs change. The scope decides what renderers lay out: the Changes scope is the
 * changes and the unchanged items that give them context (`changeContext`), and renderers fold or leave out the rest.
 * The summary filter and find narrow within it (`visibleRows`) without removing anything from the layout: renderers
 * recede what they leave out (the filter's `ids`), in either scope. The counts are of the kinds the summary bar's count
 * figures name (so a table's structural relationships aren't counted beside its columns), else of every row: its
 * changes, and every item of both revisions, so All is more than Changes whenever Changes hides any.
 */
export function createRowFilter(): (
  rows: readonly Row[],
  subject: ViewSubject,
  state: FilterState,
  summary: readonly SummaryFigure[],
) => RowFilter {
  // A comparison without changes has nothing to scope to: it shows every item (and the view says there are none).
  const unchangedOf = memo((rows: readonly Row[]) => !rows.some(isScopeChange))
  // What the scope lays out: in Changes, the changes and their context, whatever the summary filter and find.
  const scopedOf = memo((rows: readonly Row[], subject: ViewSubject, scope: ViewScope, variedOnly: boolean, regeneratedOnly: boolean) => {
    const kept = rows.filter(row => inScope(row, scope, variedOnly, regeneratedOnly))
    if (scope !== 'changes' || subject.mode !== 'comparison') return kept
    const {shown} = changeContext(rows, subject)
    return rows.filter(row => shown.has(row.id))
  })
  const keptOf = memo(
    (summaryFilter: FilterState['summaryFilter'], query: string) => (row: Row) =>
      (!summaryFilter || rowInSummary(row, summaryFilter)) && matches(row, query),
  )
  const visibleOf = memo((scoped: readonly Row[], kept: (row: Row) => boolean) => scoped.filter(kept))
  const filterOf = memo(
    (
      query: string,
      search: string,
      scope: ViewScope,
      summaryFilter: FilterState['summaryFilter'],
      rows: readonly Row[],
      kept: (row: Row) => boolean,
      visibleRows: readonly Row[],
      scopedRows: readonly Row[],
    ): FilterPayload => {
      const ids = (list: readonly Row[]) => (list.length <= rendererLimits.filterIds ? list.map(row => row.id) : null)
      // What is at full strength: what the summary filter and find keep of every item (the Changes scope lays out what
      // it shows, `scope`, and draws some items between them besides), or of the noise, which is a filter too.
      const narrowed = Boolean(query) || Boolean(summaryFilter) || scope === 'noise'
      return {
        query: search,
        changesOnly: scope === 'changes',
        ids: narrowed ? ids(scope === 'noise' ? visibleRows : rows.filter(kept)) : null,
        scope: scope === 'changes' ? ids(scopedRows) : null,
      }
    },
  )
  // What the Changes scope leaves out, whatever the scope shown now: the scope switch and the view say so.
  const hiddenRowsOf = memo((rows: readonly Row[], subject: ViewSubject, unchanged: boolean) => {
    if (subject.mode !== 'comparison' || unchanged) return []
    const {shown} = changeContext(rows, subject)
    return rows.filter(row => !shown.has(row.id))
  })
  const hiddenOf = memo(scopeHidden)
  const countsOf = memo((rows: readonly Row[], summary: readonly SummaryFigure[], hidden: ScopeHidden[]): ScopeCounts => {
    const noise = rows.filter(row => variedWithinTolerance(row) || regenerated(row)).length
    const left = hidden.reduce((total, item) => total + item.count, 0)
    // Both over the same items, the union of the revisions, so All counts what Changes leaves out besides its changes.
    const figures = summary.filter(figure => figure.type === 'count')
    const counted = figures.length ? rows.filter(row => figures.some(figure => rowInSummary(row, {kinds: figure.kinds}))) : rows
    return {changes: counted.filter(isScopeChange).length, all: counted.length, noise, hidden: left}
  })
  const resultOf = memo((visibleRows: readonly Row[], filter: FilterPayload, counts: ScopeCounts, hidden: ScopeHidden[]): RowFilter => ({
    visibleRows,
    filter,
    counts,
    hidden,
  }))
  return (rows, subject, state, summary) => {
    const {variedOnly, regeneratedOnly, summaryFilter, search} = state
    const query = search.trim().toLocaleLowerCase()
    const unchanged = unchangedOf(rows)
    const scope = state.scope === 'changes' && unchanged ? 'all' : state.scope
    const scopedRows = scopedOf(rows, subject, scope, variedOnly, regeneratedOnly)
    const kept = keptOf(summaryFilter, query)
    const visibleRows = visibleOf(scopedRows, kept)
    const filter = filterOf(query, search, scope, summaryFilter, rows, kept, visibleRows, scopedRows)
    const hidden = hiddenOf(hiddenRowsOf(rows, subject, unchanged), summary)
    return resultOf(visibleRows, filter, countsOf(rows, summary, hidden), hidden)
  }
}

/** `createRowFilter` for a component's lifetime. */
export function useRowFilter(rows: readonly Row[], subject: ViewSubject, state: FilterState, summary: readonly SummaryFigure[]): RowFilter {
  const [select] = useState(createRowFilter)
  return select(rows, subject, state, summary)
}

/**
 * What the Changes scope leaves out, by the summary bar's count figures (their nouns, in their order: kinds the renderer
 * doesn't name, such as a table's structural relationships, aren't counted), else by kind.
 */
function scopeHidden(rows: readonly Row[], summary: readonly SummaryFigure[]): ScopeHidden[] {
  if (!rows.length) return []
  const figures = summary.filter(figure => figure.type === 'count')
  if (figures.length)
    return figures
      .map(figure => ({noun: figure.noun, count: rows.filter(row => rowInSummary(row, {kinds: figure.kinds})).length}))
      .filter(item => item.count > 0)
  const kinds = new Map<string, number>()
  for (const row of rows) kinds.set(row.kind, (kinds.get(row.kind) ?? 0) + 1)
  return [...kinds].map(([kind, count]) => ({noun: humanizeKind(kind), count}))
}

type FilterActions = Pick<
  ProjectionController,
  'setScope' | 'setChangesOnly' | 'setVariedOnly' | 'setRegeneratedOnly' | 'setSummaryFilter' | 'setSearch'
>

/**
 * The scope and filter setters. The scopes exclude each other (choosing the changes leaves the noise, and the reverse);
 * the summary filter and find narrow within whichever is chosen, so setting them changes no scope.
 */
export function filterActions({variedOnly, regeneratedOnly}: FilterState, value: ValueOf, request: RequestChange): FilterActions {
  // Each value is requested only when it changes: the noise first, as it wins over the changes.
  const set = (changes: boolean, varied: boolean, regenerated: boolean) => {
    if (variedOnly !== varied) request('variedOnly', varied)
    if (regeneratedOnly !== regenerated) request('regeneratedOnly', regenerated)
    if (value('changesOnly') !== changes) request('changesOnly', changes)
  }
  return {
    setScope: scope => set(scope === 'changes', scope === 'noise', scope === 'noise'),
    setChangesOnly: next => (next ? set(true, false, false) : request('changesOnly', false)),
    setVariedOnly: next => (next ? set(false, true, false) : request('variedOnly', false)),
    setRegeneratedOnly: next => (next ? set(false, false, true) : request('regeneratedOnly', false)),
    setSummaryFilter: next => request('summaryFilter', next),
    setSearch: next => request('search', next.slice(0, rendererLimits.textLength)),
  }
}
