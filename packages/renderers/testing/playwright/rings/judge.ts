// Judging a ring's sample lines: occluded edges, changes beside the item, and each side's ring against its edge.
import type {RingGeometry, RingLineResult} from '../rings.js'

/** Where something else is drawn over the item's edge (a label's glyph), the line's edge color isn't the item's. */
export function markOccludedEdges(results: RingLineResult[]): void {
  const shown = results.filter(result => result.edgeColor && result.ring !== null && result.clean && !result.hidden)
  if (shown.length >= 3) {
    const median = [0, 1, 2].map(channel => shown.map(result => result.edgeColor![channel]!).toSorted((a, b) => a - b)[shown.length >> 1]!)
    for (const result of results) {
      if (result.edgeColor && result.edgeColor.reduce((sum, value, channel) => sum + Math.abs(value - median[channel]!), 0) > 90) {
        result.hidden = true
      }
    }
  }
}

/**
 * A change further out than the ring's stroke reaches isn't the ring: it's something beside the item (a label rings
 * restyle, a focus tooltip). A ring that far out is reported where it is missing.
 */
export function dropFarRings(results: RingLineResult[], geometry: RingGeometry): void {
  const farthest = 8 - (geometry.outward ?? 0) - 1.5 - Math.max(0, ...(geometry.inward ?? [0]))
  for (const result of results) {
    if (result.ring !== null && result.ring < farthest) {
      result.ring = null
      result.ringEnd = null
    }
  }
}

/** Each side's and corner's lines: the ring is painted, starts at the item's edge, and leaves no second edge inside it. */
export function sideFailures(
  results: RingLineResult[],
  geometry: RingGeometry,
  {curved, tolerance, label}: {curved: ReadonlySet<string>; tolerance: number; label: string},
): string[] {
  const failures: string[] = []
  const format = (value: number) => `${Math.round(value * 100) / 100} px`
  // Each line of a side, for the failure message: where along it (px from its outer end) the edge and ring start.
  const round = (value: number | null) => (value === null ? '-' : Math.round(value * 100) / 100)
  const describe = (result: RingLineResult) =>
    `${result.line}: edge ${round(result.edge)}–${round(result.edgeEnd)} rgb(${result.edgeColor?.map(Math.round).join(',') ?? '-'}), ring ${round(result.ring)}–${round(result.ringEnd)}${result.hidden ? ', hidden' : ''}`
  const groups = new Map<string, RingLineResult[]>()
  for (const result of results) {
    const name = result.line.split('@')[0]!
    groups.set(name, [...(groups.get(name) ?? []), result])
  }
  for (const [name, all] of groups) {
    // Without a ring where the item's own edge is hidden too, the ring isn't missing: it replaces the edge, gaps included.
    const group = geometry.edge === false ? all : all.filter(result => result.ring !== null || !result.hidden)
    if (!group.length) continue
    const painted = group.filter(result => result.ring !== null)
    // Painted at most places along the side (a corner has one); a dashed ring, at one at least (the others may be gaps).
    if (geometry.dashed ? !painted.length : painted.length * 2 < group.length) {
      failures.push(`${label}: no ring is painted at its ${name} (missing or clipped)`)
      continue
    }
    if (geometry.edge === false) continue
    // Where a side's line crosses a corner's curve, the edge it finds is inside the box or a neighbor's: the corner's
    // own lines measure the curve.
    const measured = painted.filter(result => result.edge !== null && result.clean && !curved.has(result.line))
    // Where the item's edge is drawn over at every line of a side (a folder's name along the top of its outline, its
    // halo the first thing each line meets), what the lines find there isn't the edge: the side can't be measured.
    if (!measured.some(result => !result.hidden)) continue
    // The place where the ring is closest to the item's edge decides: a misplaced ring is off at every place.
    const result = measured.reduce((best, item) => (Math.abs(item.ring! - item.edge!) < Math.abs(best.ring! - best.edge!) ? item : best))
    const offsetFromEdge = result.ring! - result.edge!
    const where = ` (${all.map(describe).join('; ')})`
    const sides = {
      top: [0],
      right: [1],
      bottom: [2],
      left: [3],
      'top-left': [0, 3],
      'top-right': [0, 1],
      'bottom-right': [2, 1],
      'bottom-left': [2, 3],
    }
    const inward = Math.max(
      0,
      ...(Object.hasOwn(sides, name) ? sides[name as keyof typeof sides] : []).map(side => geometry.inward?.[side] ?? 0),
    )
    if (offsetFromEdge > tolerance + inward) {
      failures.push(
        `${label}: at its ${name}, the ring starts ${format(offsetFromEdge)} inside the item's edge, which stays visible outside it${where}`,
      )
    } else if (offsetFromEdge < -tolerance - (geometry.outward ?? 0)) {
      failures.push(`${label}: at its ${name}, the ring starts ${format(-offsetFromEdge)} outside the item's edge${where}`)
    } else if (
      !inward &&
      (geometry.outward === undefined || geometry.outward === 0) &&
      result.edgeEnd !== null &&
      result.ringEnd !== null &&
      result.edgeEnd - result.ringEnd > tolerance
    ) {
      failures.push(
        `${label}: at its ${name}, the item's edge continues ${format(result.edgeEnd - result.ringEnd)} inside the ring: a second edge${where}`,
      )
    }
  }
  return failures
}
