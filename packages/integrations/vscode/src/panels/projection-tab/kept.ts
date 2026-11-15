// The extractions a projection tab showed last, kept for its page to present again when VS Code drops the hidden tab's
// webview and reloads it (no `retainContextWhenHidden`): nothing extracts again on its own. Only the most recent tabs
// keep theirs.
import {samePair} from '../../projections/pairs.js'
import type {Pair} from '../../projections/pairs.js'
import type {TabRestore} from '../../protocol.js'

type Results = NonNullable<TabRestore['results']>

export interface Kept {
  pair: Pair
  results: Results
}

/** The tabs' kept results, least recently kept first. */
const keeping: KeptResults[] = []
const keepLimit = 8

/** One tab's kept results. */
export class KeptResults {
  value: Kept | undefined

  /** Keeps the page's new results; the oldest tab's beyond the limit are dropped (it extracts again when shown). */
  keep(pair: unknown, results: unknown): Kept | undefined {
    const shown = pair as Partial<Pair> | null
    if (typeof shown?.after !== 'string' || typeof results !== 'object' || results === null) return undefined
    this.value = {
      pair: {...(typeof shown.before === 'string' ? {before: shown.before} : {}), after: shown.after},
      results: results as Results,
    }
    const at = keeping.indexOf(this)
    if (at >= 0) keeping.splice(at, 1)
    keeping.push(this)
    while (keeping.length > keepLimit) keeping.shift()!.value = undefined
    return this.value
  }

  /** The kept results when they are for `pair`. */
  for(pair: Pair | undefined): Kept | undefined {
    return this.value && pair && samePair(this.value.pair, pair) ? this.value : undefined
  }

  /** The kept results a reloaded page can present again: for `pair`, each applying `definitionRevision`. */
  restorable(pair: Pair | undefined, definitionRevision: string): Results | undefined {
    const kept = this.for(pair)
    return kept && Object.values(kept.results).every(result => (result.definition ?? 'working-tree') === definitionRevision)
      ? kept.results
      : undefined
  }

  /** Forgets the results, as a window reload would. */
  forget() {
    this.value = undefined
  }

  /** The tab closed: it keeps nothing. */
  dispose() {
    const at = keeping.indexOf(this)
    if (at >= 0) keeping.splice(at, 1)
    this.value = undefined
  }
}
