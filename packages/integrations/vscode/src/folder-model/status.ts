import {samePair, type Pair} from '../projections/pairs.js'
import {statusText, type TabSummary} from '../projections/rows.js'
import type {DefinitionPolicy} from '../projections/definitions.js'
import type {Counted} from './changes.js'

/** What a projection's row is told for the folder's choice's pair. */
export interface RowFacts {
  pair: Pair | undefined
  /** An open tab's report on the pair. */
  summary: TabSummary | undefined
  /** Compare All's count, on whichever pair it was counted. */
  counted: Counted | undefined
  policy: DefinitionPolicy | undefined
  executionAuthorized: boolean
  invalid: boolean
  /** Whether its unpinned tab found its shown result out of date. */
  stale: boolean
}

/**
 * What a row says for the folder's choice's pair: "Out of date" when its tab's result (or its count) is, else a tab's
 * report or Compare All's count on that pair, else its policy.
 */
export function rowStatus({pair, summary, counted, policy, executionAuthorized, invalid, stale}: RowFacts): string {
  const current = counted && samePair(counted.pair, pair) ? counted : undefined
  if (!invalid && (stale || (!summary && current?.stale))) return 'Out of date'
  return statusText({
    invalid,
    ...(policy ? {policy} : {}),
    executionAuthorized,
    single: Boolean(pair && !pair.before),
    ...(summary
      ? {summary}
      : current?.failed
        ? {summary: {status: 'failed', error: current.failed}}
        : current?.count !== undefined
          ? {summary: {status: 'ok', comparison: {compared: true, rows: 0, changes: {changed: current.count}}}}
          : {}),
  })
}
