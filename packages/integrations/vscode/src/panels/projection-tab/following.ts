// Whether a projection tab follows the folder's choice or is pinned to its own, the pair it shows, and the pair either
// moved to with the refs, which it shows once refreshed. Only a tab that follows reports to the folder's rows: a pinned
// tab's counts and staleness are for its own pair.
import type {Choice} from '../../choices/model.js'
import type {FolderModel} from '../../folder-model.js'
import {samePair, type Pair} from '../../projections/pairs.js'
import type {TabSummary} from '../../projections/rows.js'
import {movedPin} from './context.js'
import type {TabStale} from './freshness.js'

export type Pin = Choice & {pair: Pair}

export class Following {
  /** The choice the tab is pinned to and its pair (kept with the page's state), or none: it follows the folder's. */
  pinned: Pin | undefined
  /** The folder pair the tab last followed. */
  followed: Pair | undefined
  /** The pair the repository's choice (or the pinned choice) moved to with the refs, shown once refreshed. */
  private pendingPair: Pair | undefined
  private pendingPin: Pin | undefined

  private readonly model: () => FolderModel
  private readonly projection: string

  constructor(model: () => FolderModel, projection: string) {
    this.model = model
    this.projection = projection
  }

  /** Whether the choice moved to a pair the tab shows once refreshed. */
  get pending(): boolean {
    return Boolean(this.pendingPair ?? this.pendingPin)
  }

  /** The pair the tab shows: its pinned pair, else the folder's it follows. */
  shown(): Pair | undefined {
    return this.pinned?.pair ?? this.followed ?? this.model().pair
  }

  /**
   * The folder's model changed. A pinned tab's result is out of date when its choice moved with the refs. A tab that
   * isn't pinned follows a pick at once (the pair returned); a pair that moved with the refs (a new merge base) makes a
   * shown result (`stamped`) out of date instead: nothing extracts on its own.
   */
  modelChanged(stamped: boolean): Pair | undefined {
    const model = this.model()
    this.pendingPin = movedPin(this.pinned, model)
    if (this.pinned) return undefined
    if (!model.pair || samePair(model.pair, this.followed)) this.pendingPair = undefined
    else if (model.pairCause === 'refs' && stamped) this.pendingPair = model.pair
    else return model.pair
    return undefined
  }

  /** The tab shows the folder's pair. */
  follow(pair: Pair) {
    this.followed = pair
    this.pendingPair = undefined
  }

  /** Refresh: the pin the pinned choice moved to, which the tab pins to now. */
  takePendingPin(): Pin | undefined {
    const pin = this.pendingPin
    this.pendingPin = undefined
    return pin
  }

  /** Refresh: the folder's pair the choice moved to, which a tab that follows shows now. */
  pendingFollow(): Pair | undefined {
    const pair = this.model().pair
    return !this.pinned && this.pendingPair && pair ? pair : undefined
  }

  /** Whether the shown result is out of date, for the projection's row. */
  reportStale(stale: TabStale | undefined) {
    if (!this.pinned) this.model().reportStale(this.projection, stale)
  }

  /** The page's report of its result, for the projection's row. */
  report(summary: TabSummary) {
    if (!this.pinned) this.model().report(this.projection, summary)
  }

  /** Refresh: the row's count is forgotten until the page reports again. */
  refreshing() {
    if (!this.pinned) this.model().summaries.delete(this.projection)
  }

  /** The tab closed: its row isn't out of date by it, and nothing reports the pairs it was still extracting. */
  closed() {
    this.reportStale(undefined)
    this.model().summaries.delete(this.projection, summary => summary.status === 'extracting' && !summary.comparison)
  }
}
