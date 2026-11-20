// Validating the host's scope, summary filter and find.
import {rendererLimits} from './frame.js'
import type {HostMessage} from './messages.js'

/** A list of at most `rendererLimits.filterIds` selection IDs, or `null`. */
const idList = (value: unknown): value is string[] | null =>
  value === null || (Array.isArray(value) && value.length <= rendererLimits.filterIds && value.every(id => typeof id === 'string'))

/** A `filter`: the find query, the Changes scope and what matches within it. */
export function filter(message: Record<string, unknown>): HostMessage | undefined {
  const {query, changesOnly, ids, scope} = message
  if (typeof query !== 'string' || query.length > rendererLimits.textLength || typeof changesOnly !== 'boolean') return undefined
  if (!idList(ids) || (scope !== undefined && !idList(scope))) return undefined
  const copy = (list: string[] | null) => (list === null ? null : [...list])
  return {type: 'filter', query, changesOnly, ids: copy(ids), ...(scope === undefined ? {} : {scope: copy(scope)})}
}
