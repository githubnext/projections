// Whether moving between two layouts would pass one card or boundary through another.
import type {GraphLayout} from '../layout.js'

/** How far two boxes may overlap, in layout units, before they collide: touching faces don't. */
const tolerance = 0.5

/** Where on [0, 1] a linear function from `start` (at 0) to `end` (at 1) is below zero, if anywhere. */
function belowZero(start: number, end: number): [number, number] | undefined {
  if (start < 0 && end < 0) return [0, 1]
  if (start >= 0 && end >= 0) return undefined
  const root = start / (start - end)
  return start < 0 ? [0, root] : [root, 1]
}

/**
 * Whether interpolating every row both layouts place, its centre and size, from `a` to `b` ever overlaps two rows
 * neither of which contains the other. Exact: centres and sizes are linear in the move's mix, so on each axis the
 * mixes where two boxes overlap form one interval.
 */
export function moveCollides(a: GraphLayout, b: GraphLayout): boolean {
  if (a === b) return false
  const parent = new Map<string, string>()
  for (const layout of [a, b]) for (const [group, children] of layout.groups) for (const child of children) parent.set(child, group)
  const within = (child: string, ancestor: string) => {
    for (let at = parent.get(child), seen = 0; at !== undefined && seen < parent.size; at = parent.get(at), seen++)
      if (at === ancestor) return true
    return false
  }
  const ids = [...a.points.keys()].filter(id => b.points.has(id))
  const box = (layout: GraphLayout, id: string) => ({...layout.points.get(id)!, ...layout.sizes.get(id)!})
  const boxes = ids.map(id => ({id, from: box(a, id), to: box(b, id)}))
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const p = boxes[i]!,
        q = boxes[j]!
      if (within(p.id, q.id) || within(q.id, p.id)) continue
      let span: [number, number] = [0, 1]
      for (const [axis, extent] of [
        ['x', 'width'],
        ['y', 'height'],
      ] as const) {
        // Overlap on an axis: |Δcentre| < half the summed extents, less the tolerance.
        const gap = (box: typeof p.from, other: typeof p.from, sign: number) =>
          sign * (box[axis] - other[axis]) - (box[extent] + other[extent]) / 2 + tolerance
        for (const sign of [1, -1]) {
          const below = belowZero(gap(p.from, q.from, sign), gap(p.to, q.to, sign))
          if (!below) {
            span = [1, 0]
            break
          }
          span = [Math.max(span[0], below[0]), Math.min(span[1], below[1])]
        }
        if (span[0] >= span[1]) break
      }
      if (span[0] < span[1]) return true
    }
  return false
}
