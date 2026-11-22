// Painted boxes centred in a bar, chip or button off whole pixels (probe call `pixels`).
import type {OffPixelChild} from '../types.js'
import {innerEdges} from './labels.js'
import {colorAlpha, describe, px} from './paint.js'

/** The tallest (or, across, widest) box whose centred contents are held to whole pixels: a bar, chip or button. */
const largest = 48
/** The widest gap a centred child keeps from the box's edge: farther, it isn't centred in a control but laid out. */
const widestGap = 16
const whole = (value: number) => Math.abs(value - Math.round(value)) <= 0.02

/** Whether an HTML element paints: a background (an icon's mask over its color included), a visible border, or replaced content. */
function painted(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false
  const style = getComputedStyle(element)
  if (style.visibility === 'hidden' || ['none', 'inline', 'contents'].includes(style.display) || Number(style.opacity) <= 0.01) return false
  if (colorAlpha(style.backgroundColor) > 0.01 || style.backgroundImage !== 'none' || element.matches('img, canvas, video, iframe')) {
    return true
  }
  return ['top', 'right', 'bottom', 'left'].some(
    side =>
      style.getPropertyValue(`border-${side}-style`) !== 'none' &&
      px(style.getPropertyValue(`border-${side}-width`)) > 0 &&
      colorAlpha(style.getPropertyValue(`border-${side}-color`)) > 0.01,
  )
}

/**
 * The gaps either side of a child centred in a box along one axis, or none when it isn't centred there: equal gaps, or
 * a pixel apart, as a table cell centres an odd leftover; anything else is laid out (padding, a taller neighbour).
 */
function centredGaps(before: number, after: number, room: number): [number, number] | undefined {
  if (room > largest || before <= 0.01 || after <= 0.01 || before > widestGap || after > widestGap) return undefined
  const apart = Math.abs(before - after)
  return apart <= 0.02 || Math.abs(apart - 1) <= 0.02 ? [before, after] : undefined
}

/**
 * Every painted box (an icon, a pill, a mark) centred in the bar, chip or button that holds it (its nearest painted
 * ancestor, at most 48px across that way, with at most 16px either side) whose gaps either side aren't equal and whole:
 * a half pixel either side, or one more on one side than the other, which snapping to device pixels makes uneven. A box
 * centres on whole pixels when the room around it is whole and even: whole line boxes (the kit's `pk-label`) and
 * even icons.
 */
export function offPixelChildren(root: Element = document.body): OffPixelChild[] {
  const found: OffPixelChild[] = []
  for (const child of root.querySelectorAll('*')) {
    if (!painted(child)) continue
    let holder = child.parentElement
    while (holder && holder !== root && !painted(holder)) holder = holder.parentElement
    if (!holder || holder === root) continue
    const inner = child.getBoundingClientRect()
    const outer = holder.getBoundingClientRect()
    if (inner.width < 4 || inner.height < 4) continue
    const edges = innerEdges(holder, outer)
    const style = getComputedStyle(holder)
    const left = outer.left + px(style.borderLeftWidth)
    const right = outer.right - px(style.borderRightWidth)
    const gaps = [
      ['vertical', centredGaps(inner.top - edges.top, edges.bottom - inner.bottom, outer.height)],
      ['horizontal', centredGaps(inner.left - left, right - inner.right, outer.width)],
    ] as const
    for (const [axis, around] of gaps) {
      if (!around || (whole(around[0]) && whole(around[1]) && Math.abs(around[0] - around[1]) <= 0.02)) continue
      const round = (gap: number) => Math.round(gap * 100) / 100
      found.push({element: describe(child), holder: describe(holder), axis, before: round(around[0]), after: round(around[1])})
    }
  }
  return found
}
