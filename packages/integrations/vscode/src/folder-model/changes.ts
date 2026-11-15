import type {Pair} from '../projections/pairs.js'
import {staleByChanges} from '../staleness/changes.js'
import type {ChangeRecord} from '../staleness.js'

/** A projection's change count Compare All found, for the pair, generation and `HEAD` it was counted at. */
export interface Counted {
  pair: Pair
  count?: number
  failed?: string
  generation: number
  head?: string | undefined
  /** A change since made it out of date. */
  stale?: boolean
}

/** A `changes` notification's record, or nothing when it isn't one. */
export function changeRecord(params: unknown): ChangeRecord | undefined {
  const value = params as Partial<ChangeRecord> | null
  if (!value || !Number.isSafeInteger(value.generation) || !Array.isArray(value.changes) || typeof value.complete !== 'boolean')
    return undefined
  return {
    generation: value.generation!,
    changes: value.changes.filter((kind): kind is string => typeof kind === 'string'),
    complete: value.complete,
    ...(typeof value.tree === 'string' ? {tree: value.tree} : {}),
  }
}

/** Marks the counts the changes since they were counted make out of date (the changes rule). */
export function markStaleCounts(counted: Map<string, Counted>, records: readonly ChangeRecord[], head: string | undefined) {
  for (const [id, entry] of counted) {
    if (entry.stale) continue
    const refs = [entry.pair.before, entry.pair.after].filter((ref): ref is string => Boolean(ref))
    const stamp = {
      projection: id,
      pair: entry.pair,
      generation: entry.generation,
      ...(entry.head ? {head: entry.head} : {}),
      sides: refs.map(ref => ({ref})),
    }
    if (staleByChanges(stamp, {records, ...(head ? {head} : {})})) entry.stale = true
  }
}
