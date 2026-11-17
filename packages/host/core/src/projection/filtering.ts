import {useMemo} from 'react'
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
 * The rows the scope and filters keep, the filter payload renderers apply, and each scope's count. The Changes scope
 * keeps the changes that pass the summary filter and find, and the unchanged items that give them context
 * (`changeContext`), so renderers show those at full strength and fold or recede the rest. The counts are the summary
 * bar's: its count figures' changes and totals (the kinds the renderer names, so a table's structural relationships
 * aren't counted beside its columns), else every row's.
 */
export function useRowFilter(rows: readonly Row[], subject: ViewSubject, state: FilterState, summary: readonly SummaryFigure[]) {
  const {variedOnly, regeneratedOnly, summaryFilter, search} = state
  const query = search.trim().toLocaleLowerCase()
  // A comparison without changes has nothing to scope to: it shows every item (and the view says there are none).
  const unchanged = useMemo(() => !rows.some(isScopeChange), [rows])
  const scope = state.scope === 'changes' && unchanged ? 'all' : state.scope
  const visibleRows = useMemo(() => {
    const kept = rows.filter(
      row =>
        inScope(row, scope, variedOnly, regeneratedOnly) && (!summaryFilter || rowInSummary(row, summaryFilter)) && matches(row, query),
    )
    if (scope !== 'changes' || subject.mode !== 'comparison') return kept
    const {shown} = changeContext(
      rows,
      subject,
      kept.map(row => row.id),
    )
    return rows.filter(row => shown.has(row.id))
  }, [rows, subject, scope, variedOnly, regeneratedOnly, summaryFilter, query])
  const filter = useMemo<FilterPayload>(() => {
    const active = Boolean(query) || scope !== 'all' || Boolean(summaryFilter)
    return {
      query: search,
      changesOnly: scope === 'changes',
      ids: active && visibleRows.length <= rendererLimits.filterIds ? visibleRows.map(row => row.id) : null,
    }
  }, [query, search, scope, summaryFilter, visibleRows])
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
    const figures = summary.filter(figure => figure.type === 'count')
    if (!figures.length) return {changes: rows.filter(isScopeChange).length, all: rows.length, noise, hidden: left}
    const sum = (count: (figure: SummaryFigure) => number) => figures.reduce((total, figure) => total + count(figure), 0)
    return {changes: sum(figure => figure.added + figure.removed + figure.modified), all: sum(figure => figure.count), noise, hidden: left}
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
