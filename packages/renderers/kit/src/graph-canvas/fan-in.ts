// Cards many relationships converge on (hubs) grow wide enough for each to keep its own port.
import type {Relationship} from '@githubnext/projections-schemas'
import type {EntityChange} from '@githubnext/projections-renderer-sdk/presentation'
import {portInset} from '../routes/ports.js'
import type {ComparisonModel} from '../model.js'

/** The least room between two ports on a hub's in face, so each arrowhead stands apart from the next. */
export const hubPortSpacing = 12
/** The most a hub grows, as a multiple of its width: past that its ports close up again. */
export const hubGrowth = 4

/**
 * Each card's width with room on its in face (the top, in a vertical graph) for a port per relationship into it from
 * either revision, `hubPortSpacing` apart, up to `hubGrowth` times its width. A horizontal graph's in face is a card's
 * height, which keeps its kind's.
 */
export function fanInWidths(
  model: ComparisonModel,
  widths: ReadonlyMap<string, number>,
  orientation: 'vertical' | 'horizontal',
): ReadonlyMap<string, number> {
  if (orientation === 'horizontal') return widths
  const incoming = new Map<string, number>()
  const count = (row: EntityChange<Relationship>, side: 'before' | 'after') => {
    const relationship = row[side]
    if (!relationship || relationship.kind === 'contains') return undefined
    return model.entityRow[side].get(relationship.to)
  }
  for (const row of model.relationships) {
    const targets = new Set([count(row, 'before'), count(row, 'after')].filter((id): id is string => id !== undefined))
    for (const id of targets) incoming.set(id, (incoming.get(id) ?? 0) + 1)
  }
  const grown = new Map(widths)
  for (const [id, routes] of incoming) {
    const width = widths.get(id)
    if (width === undefined || routes < 2) continue
    const needed = 2 * portInset + (routes - 1) * hubPortSpacing
    if (needed > width) grown.set(id, Math.min(width * hubGrowth, needed))
  }
  return grown
}
