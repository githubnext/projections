import {useCallback, useMemo} from 'react'
import {changeContext, isScopeChange, regenerated, variedWithinTolerance} from '@githubnext/projections-renderer-sdk/presentation'
import type {ViewScope} from '@githubnext/projections-renderer-sdk/presentation'
import {humanizeKind} from '@githubnext/projections-renderer-sdk/presentation'
import {rendererLimits} from '@githubnext/projections-renderer-sdk/protocol'
import type {FilterPayload, SummaryNoun} from '@githubnext/projections-renderer-sdk/protocol'
import type {Row, ViewSubject} from '../model.js'
import {rowInSummary} from '../summary.js'
import type {SummaryFigure} from '../summary.js'
import type {RequestChange, ValueOf} from './controllable.js'
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

/**
 * The rows the scope and filters keep, the filter payload renderers apply, and each scope's count. The scope decides
 * what renderers lay out: the Changes scope is the changes and the unchanged items that give them context
 * (`changeContext`), and renderers fold or leave out the rest. The summary filter and find narrow within it
 * (`visibleRows`) without removing anything from the layout: renderers recede what they leave out (the filter's
 * `ids`), in either scope. The counts are of the kinds
 * the summary bar's count figures name (so a table's structural relationships aren't counted beside its columns), else
 * of every row: its changes, and every item of both revisions, so All is more than Changes whenever Changes hides any.
 */
export function useRowFilter(rows: readonly Row[], subject: ViewSubject, state: FilterState, summary: readonly SummaryFigure[]) {
  const {variedOnly, regeneratedOnly, summaryFilter, search} = state
  const query = search.trim().toLocaleLowerCase()
  // A comparison without changes has nothing to scope to: it shows every item (and the view says there are none).
  const unchanged = useMemo(() => !rows.some(isScopeChange), [rows])
  const scope = state.scope === 'changes' && unchanged ? 'all' : state.scope
  // What the scope lays out: in Changes, the changes and their context, whatever the summary filter and find.
  const scopedRows = useMemo(() => {
    const kept = rows.filter(row => inScope(row, scope, variedOnly, regeneratedOnly))
    if (scope !== 'changes' || subject.mode !== 'comparison') return kept
    const {shown} = changeContext(rows, subject)
    return rows.filter(row => shown.has(row.id))
  }, [rows, subject, scope, variedOnly, regeneratedOnly])
  const kept = useCallback(
    (row: Row) => (!summaryFilter || rowInSummary(row, summaryFilter)) && matches(row, query),
    [summaryFilter, query],
  )
  const visibleRows = useMemo(() => scopedRows.filter(kept), [scopedRows, kept])
  const filter = useMemo<FilterPayload>(() => {
    const ids = (list: readonly Row[]) => (list.length <= rendererLimits.filterIds ? list.map(row => row.id) : null)
    // What is at full strength: what the summary filter and find keep of every item (the Changes scope lays out what it
    // shows, `scope`, and draws some items between them besides), or of the noise, which is a filter too.
    const narrowed = Boolean(query) || Boolean(summaryFilter) || scope === 'noise'
    return {
      query: search,
      changesOnly: scope === 'changes',
      ids: narrowed ? ids(scope === 'noise' ? visibleRows : rows.filter(kept)) : null,
      scope: scope === 'changes' ? ids(scopedRows) : null,
    }
  }, [query, search, scope, summaryFilter, rows, kept, visibleRows, scopedRows])
  // What the Changes scope leaves out, whatever the scope shown now: the scope switch and the view say so.
  const hiddenRows = useMemo(() => {
    if (subject.mode !== 'comparison' || unchanged) return []
    const {shown} = changeContext(rows, subject)
    return rows.filter(row => !shown.has(row.id))
  }, [rows, subject, unchanged])
  const hidden = useMemo(() => scopeHidden(hiddenRows, summary), [hiddenRows, summary])
  const counts = useMemo<ScopeCounts>(() => {
    const noise = rows.filter(row => variedWithinTolerance(row) || regenerated(row)).length
    const left = hidden.reduce((total, item) => total + item.count, 0)
    // Both over the same items, the union of the revisions, so All counts what Changes leaves out besides its changes.
    const figures = summary.filter(figure => figure.type === 'count')
    const counted = figures.length ? rows.filter(row => figures.some(figure => rowInSummary(row, {kinds: figure.kinds}))) : rows
    return {changes: counted.filter(isScopeChange).length, all: counted.length, noise, hidden: left}
  }, [rows, summary, hidden])
  return {visibleRows, filter, counts, hidden}
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
