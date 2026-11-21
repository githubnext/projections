// Whether an HTML unit owns its visible edge, so its ring is that edge.
import {describe} from '../paint.js'
import {edgeOf, edged} from './edges.js'
import type {EdgeInfo} from './edges.js'
import {format} from './units.js'

/** Where an HTML unit's visible edge is not its own: the element to mark instead, or what to change. */
export function ownershipFailures(unit: Element, rest: EdgeInfo, name: string): string[] {
  const failures: string[] = []
  const tolerance = 0.5
  if (rest.outside > tolerance) {
    failures.push(
      `${name} draws its edge ${format(rest.outside)} outside its box (a spread box-shadow or an outline with a positive offset), where its ring can't cover it: draw the edge as a border, or as an outline with outline-offset equal to minus its width`,
    )
  }
  // A bare wrapper: the edge belongs to the card it holds.
  if (!edged(rest) && !rest.surface) {
    const box = rest.box
    for (const child of unit.querySelectorAll('*')) {
      const info = edgeOf(child)
      // A card the wrapper holds: nearly its whole width and most of its height, with an edge of its own.
      const width = info.box.right - info.box.left,
        height = info.box.bottom - info.box.top
      if (width < (box.right - box.left) * 0.85 || height < (box.bottom - box.top) * 0.6 || !(info.inside || info.outside > 0)) continue
      const gaps = [info.box.top - box.top, box.right - info.box.right, box.bottom - info.box.bottom, info.box.left - box.left]
      if (gaps.every(gap => gap < tolerance)) break
      failures.push(
        `the visible edge of ${name} is drawn by ${describe(child)}, ${format(Math.max(...gaps))} inside it, so its ring would sit outside the card: put data-entity-id (or data-projections-unit) on ${describe(child)} instead`,
      )
      break
    }
  }
  // An edged ancestor around it: flush (a row in a rounded group) needs the group's inner radius at the corners it shares;
  // a few pixels apart is a second edge around the ring.
  const box = rest.box
  for (
    let cursor = unit.parentElement, steps = 0;
    cursor && cursor !== document.body && steps < 8;
    cursor = cursor.parentElement, steps++
  ) {
    const ancestor = edgeOf(cursor)
    if (!edged(ancestor)) continue
    const gaps = [
      box.top - ancestor.padding.top,
      ancestor.padding.right - box.right,
      ancestor.padding.bottom - box.bottom,
      box.left - ancestor.padding.left,
    ]
    if (gaps.some(gap => gap < -tolerance)) break
    const flush = gaps.map(gap => gap <= tolerance)
    if (!flush.some(Boolean)) {
      if (gaps.every(gap => gap <= 8)) {
        failures.push(
          `${name} sits ${format(Math.min(...gaps))} inside the edge of ${describe(cursor)}: two concentric edges around its ring. Make ${describe(cursor)} the unit (data-projections-unit), or let ${name} fill it`,
        )
      }
      break
    }
    const borders = [
      ancestor.padding.top - ancestor.box.top,
      ancestor.box.right - ancestor.padding.right,
      ancestor.box.bottom - ancestor.padding.bottom,
      ancestor.padding.left - ancestor.box.left,
    ]
    const pairs: [number, number][] = [
      [0, 3],
      [0, 1],
      [2, 1],
      [2, 3],
    ]
    ;['top-left', 'top-right', 'bottom-right', 'bottom-left'].forEach((corner, index) => {
      const [a, b] = pairs[index]!
      if (!flush[a] || !flush[b]) return
      const outer = ancestor.box.radii[index]!
      const inner: [number, number] = [Math.max(0, outer[0] - borders[b]!), Math.max(0, outer[1] - borders[a]!)]
      const own = box.radii[index]!
      if (Math.abs(own[0] - inner[0]) > tolerance || Math.abs(own[1] - inner[1]) > tolerance) {
        failures.push(
          `${name} fills the ${corner} corner of ${describe(cursor)} with a ${format(own[0])} radius, but that corner's inner radius is ${format(inner[0])}: give ${name} border-${corner}-radius ${format(inner[0])}, so its ring follows the corner`,
        )
      }
    })
    break
  }
  // An edge inside it, a few pixels in all round: a second edge inside the ring.
  for (const child of [...unit.querySelectorAll('*')].slice(0, 300)) {
    const info = edgeOf(child)
    if (!info.inside) continue
    const gaps = [info.box.top - box.top, box.right - info.box.right, box.bottom - info.box.bottom, info.box.left - box.left]
    if (gaps.every(gap => gap > 3 + tolerance && gap <= 8)) {
      failures.push(
        `${describe(child)} draws an edge ${format(Math.min(...gaps))} inside ${name}: a second edge inside its ring; make it the unit, or drop its edge`,
      )
    }
  }
  return failures
}
