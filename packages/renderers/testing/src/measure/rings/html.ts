// An HTML unit's ring: the SDK's outline inside its box, nothing positioned over it, and an edge the unit owns.
import {describe, px, colorAlpha} from '../paint.js'
import {edgeOf, type EdgeInfo} from './edges.js'
import {ownershipFailures} from './ownership.js'
import type {RingState} from './units.js'

/**
 * A positioned descendant that paints its background over the unit's ring: browsers paint an outline under positioned
 * descendants.
 */
function coveredRing(unit: Element, box: DOMRect, name: string, isolated: boolean): string[] {
  for (const child of [...unit.querySelectorAll('*')].slice(0, 400)) {
    const childStyle = getComputedStyle(child)
    if (childStyle.position === 'static' || childStyle.visibility === 'hidden') continue
    // Below the unit's own paint: in a negative z-index layer inside a unit that is a stacking context.
    let under = false
    for (let cursor: Element | null = child; cursor && cursor !== unit; cursor = cursor.parentElement) {
      const cursorStyle = getComputedStyle(cursor)
      if (cursorStyle.position !== 'static' && (parseInt(cursorStyle.zIndex, 10) || 0) < 0) under = true
    }
    if (under && isolated) continue
    const paints = colorAlpha(childStyle.backgroundColor) > 0.01 || childStyle.backgroundImage !== 'none'
    if (!paints) continue
    const inner = child.getBoundingClientRect()
    // At (or just inside a 1 px border of) the unit's edge, it hides most of the ring there; content further in only
    // overlaps the ring's inside.
    const covers = [inner.top - box.top, box.right - inner.right, box.bottom - inner.bottom, inner.left - box.left].map(
      (gap, side) =>
        gap < 1.5 &&
        (side % 2 ? inner.bottom > box.top && inner.top < box.bottom : inner.right > box.left && inner.left < box.right) &&
        inner.width > 0 &&
        inner.height > 0,
    )
    const side = covers.findIndex(Boolean)
    if (side < 0) continue
    return [
      `${describe(child)} is positioned (${childStyle.position}) and paints its background over the ${['top', 'right', 'bottom', 'left'][side]} of ${name}'s ring: browsers paint an outline under positioned descendants. Keep it in normal flow, inset it from the unit's edge by the ring width, or put it under the unit's paint (z-index: -1, with isolation: isolate on the unit)`,
    ]
  }
  return []
}

/** An HTML unit in `state`, at `box`; `rest` is how it drew its edge at rest. */
export function htmlRingFailures(unit: Element, box: DOMRect, name: string, state: RingState, rest?: {edge: EdgeInfo}): string[] {
  const failures: string[] = []
  const style = getComputedStyle(unit)
  const width = style.outlineStyle !== 'none' ? px(style.outlineWidth) : 0
  if (width <= 0) {
    failures.push(`${name} shows no ${state} ring: the SDK draws it as the unit's outline; don't override outline on the unit`)
  } else if (Math.abs(px(style.outlineOffset) + width) > 0.5) {
    failures.push(
      `the ${state} ring on ${name} isn't drawn inside the unit (outline-offset ${style.outlineOffset}, width ${style.outlineWidth})`,
    )
  }
  failures.push(...coveredRing(unit, box, name, style.isolation === 'isolate'))
  if (rest) {
    // The neutral edge's style, at the unit's current place (the state may have scrolled it into view).
    const now = edgeOf(unit)
    failures.push(...ownershipFailures(unit, {...rest.edge, box: {...now.box, radii: rest.edge.box.radii}, padding: now.padding}, name))
  }
  return failures
}
