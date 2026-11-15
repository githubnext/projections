// An SVG unit's ring: the stroke of its marked edge, which must be the shape that draws its visible edge.
import {describe, px} from '../paint.js'
import {largestClosedShape, paintSignature} from './units.js'
import type {Neutral, RingState} from './units.js'

/** An SVG unit that marks no edge shape: its ring has nothing to restyle. */
export function unmarkedEdgeFailure(unit: Element, name: string): string {
  const body = largestClosedShape(unit)
  return `${name} marks no edge shape, so its ring has nothing to restyle: add data-projections-edge to ${body ? describe(body) : 'the shape that draws its edge (its surface, circle or line)'}`
}

/** An SVG unit with marked `edges`: the topmost edge is marked, a line isn't outlined, and the state restyles the edge. */
export function svgRingFailures(unit: Element, edges: Element[], name: string, state: RingState, neutral: Neutral | null): string[] {
  const failures: string[] = []
  const body = largestClosedShape(unit)
  // The topmost shape that draws the edge must be marked: one painted over the marked edge hides its ring.
  if (body && !edges.includes(body))
    failures.push(
      `${name}'s visible edge is ${describe(body)}, drawn over its marked edge, so it hides the ring: add data-projections-edge to ${describe(body)}`,
    )
  // A line is highlighted as itself: no outline, shadow or second stroke around it.
  if (edges.some(edge => edge.getAttribute('data-projections-edge') === 'line'))
    for (const element of [unit, ...unit.querySelectorAll('*')]) {
      const style = getComputedStyle(element)
      const outlined = style.outlineStyle !== 'none' && px(style.outlineWidth) > 0
      if (outlined || (style.boxShadow && style.boxShadow !== 'none') || style.filter.includes('drop-shadow')) {
        failures.push(`the line ${name} is outlined (${describe(element)}): a line's highlight is the line itself, never a ring around it`)
        break
      }
    }
  const changed = edges.some(edge => neutral?.edges.get(edge) !== paintSignature(edge))
  if (neutral && !changed) failures.push(`${name} shows no ${state} ring: its marked edge's stroke doesn't change`)
  return failures
}
