// The parts every summary figure shares: its noun and its counts.
import {rendererLimits} from '../frame.js'
import {record, keys, label} from '../validation.js'

/** A noun of the renderer's domain, for one item and for any other count: `{singular: 'workspace', plural: 'workspaces'}`. */
export interface SummaryNoun {
  /** The word for exactly one item, 1 to `rendererLimits.summaryNoun` characters. */
  singular: string
  /** The word for zero or several items, 1 to `rendererLimits.summaryNoun` characters. */
  plural: string
}

/** Whether a value is a summary count: a non-negative safe integer. */
export const summaryCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0

/** Validates a figure's noun: exactly `singular` and `plural`, each a short label. */
export function summaryNoun(value: unknown): SummaryNoun | undefined {
  if (!record(value) || !keys(value, ['singular', 'plural'])) return undefined
  if (!label(value.singular, rendererLimits.summaryNoun) || !label(value.plural, rendererLimits.summaryNoun)) return undefined
  return {singular: value.singular, plural: value.plural}
}

export type Fields = Record<string, unknown>
type Deltas = Partial<Record<'added' | 'removed' | 'modified', number>>

/** An item's change counts, each a non-negative integer when present. */
export function summaryChanges(item: Fields): Deltas | undefined {
  const deltas: Deltas = {}
  for (const name of ['added', 'removed', 'modified'] as const) {
    if (item[name] === undefined) continue
    if (!summaryCount(item[name])) return undefined
    deltas[name] = item[name]
  }
  return deltas
}
