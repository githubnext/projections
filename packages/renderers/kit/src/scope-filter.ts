// What of the host's filter a kit renderer reads itself: what the Changes scope lays out. What recedes, the summary
// filter's and find's matches, `connectInteractions` marks.
import type {FilterPayload} from '@githubnext/projections-renderer-sdk/protocol'
import type {ComparisonModel} from './model.js'

const sameIds = (a: readonly string[] | null | undefined, b: readonly string[] | null) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((id, index) => id === b[index]))

/**
 * What a host's `filter` lays out: whether it shows the Changes scope, and that scope's IDs (`scope`, or a host before
 * it's `ids`), as both `scope` and `ids`. `previous` while those are the same, so a summary figure or find, which only
 * recede what they leave out, lays nothing out again.
 */
export function layoutFilter(previous: FilterPayload | undefined, message: FilterPayload): FilterPayload {
  const scope = message.scope === undefined ? message.ids : message.scope
  if (previous?.changesOnly === message.changesOnly && sameIds(previous.scope, scope)) return previous
  return {query: '', changesOnly: message.changesOnly, ids: scope, scope}
}

/**
 * The change each further part of a split or merge presents, by its row's ID: the host's filter names the change, and
 * the part is kept with it (`InteractionOptions.partOf`).
 */
export function partOwners(model: ComparisonModel | undefined): ReadonlyMap<string, string> {
  const owners = new Map<string, string>()
  for (const [change, rows] of model?.changeRows ?? []) for (const row of rows) if (row !== change) owners.set(row, change)
  return owners
}
