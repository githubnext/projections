/*
 * How one switch of what the side bar shows becomes one update: requests in a burst run once, and only when what they
 * would show changed (`coalesce`, `changed`); each projection's summaries are kept by pair, so a pair shown again has
 * its counts at once (`PairSummaries`); and a tab's switches are numbered, so a report about an earlier one is
 * recognized as stale (`Switches`). Nothing here imports VS Code.
 */
import type {Pair} from './projections/pairs.js'
import type {TabSummary} from './projections/rows.js'

interface Timers {
  set(run: () => void, ms: number): unknown
  clear(timer: unknown): void
}
const realTimers: Timers = {set: (run, ms) => setTimeout(run, ms), clear: timer => clearTimeout(timer as ReturnType<typeof setTimeout>)}

/**
 * `run` once for a burst of `request()`s: after `delayMs` (0, the end of the current turn of the event loop) from the
 * first. `flush()` runs a requested update now.
 */
export function coalesce(run: () => void, {delayMs = 0, timers = realTimers}: {delayMs?: number; timers?: Timers} = {}) {
  let timer: unknown
  let requested = false
  const fire = () => {
    if (!requested) return
    requested = false
    timers.clear(timer)
    timer = undefined
    run()
  }
  return {
    request() {
      if (requested) return
      requested = true
      timer = timers.set(fire, delayMs)
    },
    flush: fire,
    get pending() {
      return requested
    },
    dispose() {
      requested = false
      timers.clear(timer)
    },
  }
}

/** Whether `value` differs from what it was the last time (by its JSON); the first value is a change. */
export function changed(): (value: unknown) => boolean {
  let last: string | undefined
  return value => {
    const text = JSON.stringify(value) ?? 'undefined'
    if (text === last) return false
    last = text
    return true
  }
}

const pairKey = (pair: {before?: string | undefined; after?: string | undefined}) => `${pair.before ?? ''}..${pair.after ?? ''}`

/**
 * Each projection's summaries by pair (the most recent `limit` pairs): a tab's report for the pair it shows, or that
 * it is extracting a pair it was just switched to.
 */
export class PairSummaries {
  private readonly byProjection = new Map<string, Map<string, TabSummary>>()
  private readonly limit: number

  constructor(limit = 8) {
    this.limit = limit
  }

  /** A projection's summary for `pair`, if one is kept. */
  get(id: string, pair: Pair | undefined): TabSummary | undefined {
    return pair ? this.byProjection.get(id)?.get(pairKey(pair)) : undefined
  }

  /** Keeps a summary for its pair (a summary without one isn't kept). */
  set(id: string, summary: TabSummary) {
    if (!summary.pair?.after) return
    const pairs = this.byProjection.get(id) ?? new Map<string, TabSummary>()
    const key = pairKey(summary.pair)
    pairs.delete(key)
    pairs.set(key, summary)
    for (const old of [...pairs.keys()].slice(0, Math.max(0, pairs.size - this.limit))) pairs.delete(old)
    this.byProjection.set(id, pairs)
  }

  /**
   * A tab switched to `pair`: unless a summary for it is kept, it is extracting. Returns whether that changed anything.
   */
  switching(id: string, pair: Pair): boolean {
    const kept = this.get(id, pair)
    if (kept) {
      // Shown again: the most recent.
      this.set(id, kept)
      return false
    }
    this.set(id, {pair: {...(pair.before ? {before: pair.before} : {}), after: pair.after}, status: 'extracting'})
    return true
  }

  /** Forgets a projection's summaries (its tab refreshes, or closes while extracting). */
  delete(id: string, only?: (summary: TabSummary) => boolean) {
    const pairs = this.byProjection.get(id)
    if (!pairs) return
    for (const [key, summary] of pairs) if (!only || only(summary)) pairs.delete(key)
  }

  /** Keeps only the summaries for `pair` (what changed in the repository may change the others' counts). */
  keepOnly(pair: Pair | undefined) {
    for (const pairs of this.byProjection.values()) {
      for (const key of [...pairs.keys()]) if (!pair || key !== pairKey(pair)) pairs.delete(key)
    }
  }
}

/**
 * A tab's switches of pair, numbered. The page reports the switch it shows; a report about an earlier one (sent before
 * the page applied the latest) is stale. A page that hasn't been switched since it loaded shows the latest.
 */
export class Switches {
  private latest = 0

  /** Numbers the next switch. */
  next(): number {
    return ++this.latest
  }

  /** Whether a report from the page (with the switch it shows, if any) is about the latest switch. */
  current(reported: unknown): boolean {
    return typeof reported !== 'number' || reported >= this.latest
  }
}
