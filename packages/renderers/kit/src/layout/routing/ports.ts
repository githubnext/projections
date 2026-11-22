// Ports on a card's in face for the routes into it.
import {spreadPorts} from '../../routes/ports.js'
import {compareIds} from '../model.js'
import type {RoutingContext, Segment} from './context.js'
import {build} from './build.js'

/**
 * Ports for the routes into one card, in the given order (where they
 * approach from): spread evenly across its in face, dividing it into equal
 * parts (two routes enter at its thirds), never closer than `portInset` to
 * its corners (see `spreadPorts`), so converging routes keep their order,
 * their arrowheads stand well apart, and a lone route arrives in the middle.
 */
export function assign(ctx: RoutingContext, target: string, ordered: readonly Segment[]): void {
  const {across, at, box, breadth, inFace} = ctx
  const middle = across(box(target))
  const offsets = spreadPorts(ordered.length, breadth(target), breadth(target) / (ordered.length + 1))
  for (const [index, segment] of ordered.entries()) {
    const end = at(inFace(target), middle + offsets[index]!)
    const moved = !segment.end || Math.hypot(segment.end.x - end.x, segment.end.y - end.y) > 1e-6
    segment.end = end
    // A route already built follows its port.
    if (moved && segment.route) build(ctx, segment)
  }
}

/** Routes into one card in the order they leave their sources, as `assign` first places their ports. */
export function byLeaving(ctx: RoutingContext, list: readonly Segment[]): Segment[] {
  const key = (segment: Segment) => ctx.across(segment.start)
  return list.toSorted((a, b) => key(a) - key(b) || compareIds(a.key, b.key))
}
