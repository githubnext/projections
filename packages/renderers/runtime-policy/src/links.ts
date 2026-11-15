import type {Relationship} from '@githubnext/projections-schemas'
import type {ComparisonModel} from '@githubnext/projections-renderer-kit'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import type {Item, Revision, Side} from './model.js'

export interface Links {
  hookOf: Map<string, string>
  policyOf: Map<string, string>
  probeOf: Map<string, string>
  chips: Map<string, {row: EntityChange<Relationship>; relationship: Relationship; to: string}[]>
  /** Policies covering each workload: `covers` relationships keyed by their workload. */
  coveredBy: Map<string, {row: EntityChange<Relationship>; relationship: Relationship; to: string}[]>
}

export function links(model: ComparisonModel, revision: Revision): Links {
  const rows = model.entityRow[revision]
  const result: Links = {hookOf: new Map(), policyOf: new Map(), probeOf: new Map(), chips: new Map(), coveredBy: new Map()}
  for (const row of model.relationships) {
    const relationship = row[revision]
    if (!relationship) continue
    const from = rows.get(relationship.from),
      to = rows.get(relationship.to)
    if (!from || !to) continue
    if (relationship.kind === 'attaches') result.hookOf.set(from, to)
    else if (relationship.kind === 'declares') result.policyOf.set(to, from)
    else if (relationship.kind === 'filters') result.probeOf.set(to, from)
    else if (relationship.kind === 'covers') {
      const list = result.coveredBy.get(to) ?? []
      list.push({row, relationship, to: from})
      result.coveredBy.set(to, list)
    } else if (['matches', 'excludes', 'applies-to'].includes(relationship.kind)) {
      const list = result.chips.get(from) ?? []
      list.push({row, relationship, to})
      result.chips.set(from, list)
    }
  }
  return result
}

/** What every part of the model is built from: the comparison, the side shown, both revisions' links and the items. */
export interface Context {
  model: ComparisonModel
  side: Side
  sides: Record<Revision, Links>
  items: Map<string, Item>
}

/** Every entity the frame shows, with the comparator's interpretations of its change. */
export function itemsOf(model: ComparisonModel, side: Side, interpretations: Map<string, string[]> | undefined): Map<string, Item> {
  const items = new Map<string, Item>()
  for (const row of model.entities) {
    const entity = side === 'diff' ? (row.after ?? row.before) : row[side]
    if (!entity) continue
    items.set(row.id, {
      row,
      entity,
      ...(row.before ? {before: row.before} : {}),
      ...(row.after ? {after: row.after} : {}),
      interpretations: interpretations?.get(row.id) ?? interpretations?.get(row.after?.id ?? row.before!.id) ?? [],
    })
  }
  return items
}

/** Which revision's relationships place an item: the after one when it has one. */
export const placed = ({side, sides}: Context, item: Item): Links => (side === 'before' || !item.row.after ? sides.before : sides.after)
