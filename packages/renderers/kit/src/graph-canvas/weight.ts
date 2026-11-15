// Cards weighed, such as by lines of code: each card's share of the heaviest, which its gauge draws.
import type {Entity} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'

/** A row's weight as a share of the heaviest row's, by revision (see `weightShares`). */
export interface WeightShare {
  /** The share in the Before revision, between 0 and 1; none when it has no positive weight there. */
  before?: number
  /** The share in the After revision, between 0 and 1; none when it has no positive weight there. */
  after?: number
}

/**
 * Each weighed row's weight in each revision as the square root of its share of the heaviest weight of either, so
 * area-like differences read without the heaviest dwarfing the rest. Rows without a positive weight have none.
 */
export function weightShares(
  rows: readonly EntityChange<Entity>[],
  weight: (entity: Entity) => number | undefined,
): Map<string, WeightShare> {
  const value = (entity: Entity | undefined) => {
    const raw = entity ? weight(entity) : undefined
    return raw !== undefined && Number.isFinite(raw) && raw > 0 ? raw : undefined
  }
  const heaviest = Math.max(0, ...rows.flatMap(row => [value(row.before) ?? 0, value(row.after) ?? 0]))
  const shares = new Map<string, WeightShare>()
  if (!heaviest) return shares
  for (const row of rows) {
    const [before, after] = [value(row.before), value(row.after)]
    if (before === undefined && after === undefined) continue
    shares.set(row.id, {
      ...(before === undefined ? {} : {before: Math.sqrt(before / heaviest)}),
      ...(after === undefined ? {} : {after: Math.sqrt(after / heaviest)}),
    })
  }
  return shares
}
