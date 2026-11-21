// Which definition a projection tab applies: the working tree's (your edits) while the projection has uncommitted edits,
// unless Show committed holds the tab on the committed version for those edits.
import {definitionRevisionFor} from '../../edits.js'
import type {FolderModel} from '../../folder-model.js'
import type {Pair} from '../../projections/pairs.js'
import type {TabPairLabels} from '../../protocol.js'

export class DefinitionRevision {
  /**
   * Show committed: the `editKey` of the edits this tab shows the committed definition for. It holds until the edits
   * change again (another key) or Use my edits; uncommitted edits otherwise apply (`definitionRevisionFor`).
   */
  private committedKey: string | undefined

  private readonly model: () => FolderModel
  private readonly projection: string

  constructor(model: () => FolderModel, projection: string) {
    this.model = model
    this.projection = projection
  }

  /** The projection's current edits (`editKey`), if it has any. */
  private get editsKey(): string | undefined {
    return this.model().editKeys.get(this.projection)
  }

  /** Whether this tab shows the committed definition for the projection's current edits. */
  showsCommitted(): boolean {
    const key = this.editsKey
    return Boolean(key && this.committedKey === key)
  }

  /** The revision whose definition this tab applies to a pair: the working tree's while it has edits, unless Show committed. */
  for(pair: Pair | undefined): 'working-tree' | 'HEAD' {
    const model = this.model()
    return definitionRevisionFor({
      now: Boolean(pair && !pair.before && pair.after === 'working-tree'),
      state: model.edits.get(this.projection),
      committed: this.showsCommitted(),
      hasCommits: Boolean(model.head),
    })
  }

  /** Show committed ends when the edits change again (or are committed or discarded): the edits apply. */
  editsChanged() {
    if (this.committedKey && !this.showsCommitted()) this.committedKey = undefined
  }

  /**
   * Show committed for the current edits, or back to them (Use my edits): what the page applies (`key`, or `null` for
   * the edits), or nothing when there are no edits to hold back.
   */
  show(show: boolean): {key: string | null} | undefined {
    const key = this.editsKey
    if (show && !key) return undefined
    this.committedKey = show ? key : undefined
    return {key: show ? key! : null}
  }

  /** A tab restored with the window remembers Show committed while the edits are the same (its page applied it). */
  restore(committed: string | null | undefined) {
    if (committed && committed === this.editsKey) this.committedKey = committed
  }

  /** Forgets Show committed, as a window reload would. */
  forget() {
    this.committedKey = undefined
  }

  /**
   * Whether the shown results (applying `applied`) apply the definition's uncommitted edits ("Your edits", with Show
   * committed) or, by Show committed, the committed version (with Use my edits). Nothing while it has no edits, or
   * until Refresh applies them.
   */
  edits(pair: Pair | undefined, applied: string | undefined): TabPairLabels['edits'] {
    if (this.model().edits.get(this.projection) !== 'edited') return undefined
    if ((applied ?? this.for(pair)) === 'working-tree') return 'yours'
    return this.showsCommitted() ? 'committed' : undefined
  }
}
