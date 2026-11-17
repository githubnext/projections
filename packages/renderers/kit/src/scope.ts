// The Changes scope as kit renderers present it: which items a comparison shows (its changes and their context), and
// how a list folds the runs of items it doesn't show.
import {changeContext, isScopeChange, scopeRows} from '@githubnext/projections-renderer-sdk/presentation'
import type {ChangesScope} from '@githubnext/projections-renderer-sdk/presentation'
import type {FilterPayload} from '@githubnext/projections-renderer-sdk/protocol'
import type {ComparisonModel} from './model.js'

export type {ChangesScope} from '@githubnext/projections-renderer-sdk/presentation'

/**
 * The Changes scope a renderer presents, or undefined when the host shows every item (or this is one extraction). The
 * host's filter `ids` are what it shows, its changes and their context; past the filter's ID limit, or before the host
 * says, the kit derives the same from the comparison's structure (`changeContext`).
 */
export function changesScope(model: ComparisonModel | undefined, filter: FilterPayload | undefined): ChangesScope | undefined {
  if (!model || model.mode !== 'comparison' || !filter?.changesOnly) return undefined
  if (filter.ids === null) return changeContext(scopeRows(model), model)
  const shown = new Set(filter.ids)
  const changes = new Set<string>()
  const context = new Set<string>()
  for (const row of [...model.entities, ...model.relationships]) {
    if (!shown.has(row.id)) continue
    if (isScopeChange(row)) changes.add(row.id)
    else context.add(row.id)
  }
  return {changes, context, shown}
}

/** One entry of a folded list: an item it shows, or a fold standing for a run of items it doesn't. */
export type Folded<T> = {type: 'item'; item: T} | {type: 'fold'; key: string; items: T[]}

/**
 * A list with every run of items `shown` leaves out folded into one entry, keyed by its first item, unless `expanded`
 * names it; a run of one item stays, as its fold would take as much room. Every item is shown when `shown` is
 * undefined. Fold the union of a comparison (or each pane's list in the union's order) so both revisions fold alike.
 */
export function foldList<T>(
  items: readonly T[],
  idOf: (item: T) => string,
  shown: ReadonlySet<string> | undefined,
  expanded: ReadonlySet<string> = new Set(),
): Folded<T>[] {
  if (!shown) return items.map(item => ({type: 'item', item}))
  const entries: Folded<T>[] = []
  let run: T[] = []
  const flush = () => {
    const key = run.length ? idOf(run[0]!) : ''
    if (run.length > 1 && !expanded.has(key)) entries.push({type: 'fold', key, items: run})
    else for (const item of run) entries.push({type: 'item', item})
    run = []
  }
  for (const item of items) {
    if (shown.has(idOf(item))) {
      flush()
      entries.push({type: 'item', item})
    } else run.push(item)
  }
  flush()
  return entries
}
