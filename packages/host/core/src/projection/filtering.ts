import {useMemo} from 'react'
import {regenerated, variedWithinTolerance} from '@githubnext/projections-renderer-sdk/presentation'
import {rendererLimits} from '@githubnext/projections-renderer-sdk/protocol'
import type {FilterPayload} from '@githubnext/projections-renderer-sdk/protocol'
import type {Row} from '../model.js'
import {rowInSummary} from '../summary.js'
import type {RequestChange, ValueOf} from './controllable.js'
import type {ProjectionController} from './types.js'

function matches(row: Row, query: string): boolean {
  return !query || `${row.id} ${row.label} ${row.kind} ${row.summary ?? ''}`.toLocaleLowerCase().includes(query)
}

/** The row filters in effect: varied only, regenerated only and a summary filter each turn off the ones after them. */
export function filterState(comparing: boolean, value: ValueOf) {
  const variedOnly = comparing && value('variedOnly')
  const regeneratedOnly = comparing && !variedOnly && value('regeneratedOnly')
  const summaryFilter = value('summaryFilter') ?? null
  const changesOnly = comparing && !variedOnly && !regeneratedOnly && !summaryFilter && value('changesOnly')
  return {variedOnly, regeneratedOnly, summaryFilter, changesOnly, search: value('search')}
}

export type FilterState = ReturnType<typeof filterState>

const isChange = (row: Row) => row.status !== 'unchanged' || (row.correspondence !== undefined && row.correspondence !== 'exact')

/** The rows the filters keep, and the filter payload renderers apply. */
export function useRowFilter(rows: readonly Row[], {changesOnly, variedOnly, regeneratedOnly, summaryFilter, search}: FilterState) {
  const query = search.trim().toLocaleLowerCase()
  const visibleRows = useMemo(
    () =>
      rows.filter(
        row =>
          (!changesOnly || isChange(row)) &&
          (!variedOnly || variedWithinTolerance(row)) &&
          (!regeneratedOnly || regenerated(row)) &&
          (!summaryFilter || rowInSummary(row, summaryFilter)) &&
          matches(row, query),
      ),
    [rows, changesOnly, variedOnly, regeneratedOnly, summaryFilter, query],
  )
  const filter = useMemo<FilterPayload>(() => {
    const active = Boolean(query) || changesOnly || variedOnly || regeneratedOnly || Boolean(summaryFilter)
    return {
      query: search,
      changesOnly,
      ids: active && visibleRows.length <= rendererLimits.filterIds ? visibleRows.map(row => row.id) : null,
    }
  }, [query, search, changesOnly, variedOnly, regeneratedOnly, summaryFilter, visibleRows])
  return {visibleRows, filter}
}

type FilterActions = Pick<
  ProjectionController,
  'setChangesOnly' | 'setVariedOnly' | 'setRegeneratedOnly' | 'setSummaryFilter' | 'setSearch'
>

/** The filter setters: turning one row filter on turns the others off. */
export function filterActions(
  {variedOnly, regeneratedOnly, summaryFilter}: FilterState,
  value: ValueOf,
  request: RequestChange,
): FilterActions {
  const clear = (filters: {changes?: boolean; varied?: boolean; regenerated?: boolean; summary?: boolean}) => {
    if (filters.changes && value('changesOnly')) request('changesOnly', false)
    if (filters.varied && variedOnly) request('variedOnly', false)
    if (filters.regenerated && regeneratedOnly) request('regeneratedOnly', false)
    if (filters.summary && summaryFilter) request('summaryFilter', null)
  }
  return {
    setChangesOnly: next => {
      if (next) clear({varied: true, regenerated: true, summary: true})
      request('changesOnly', next)
    },
    setVariedOnly: next => {
      if (next) clear({changes: true, regenerated: true, summary: true})
      request('variedOnly', next)
    },
    setRegeneratedOnly: next => {
      if (next) clear({changes: true, varied: true, summary: true})
      request('regeneratedOnly', next)
    },
    setSummaryFilter: next => {
      if (next) clear({changes: true, varied: true, regenerated: true})
      request('summaryFilter', next)
    },
    setSearch: next => request('search', next.slice(0, rendererLimits.textLength)),
  }
}
