// The corners a box draws its edge over its contents at: an overlaid pseudo-element, its own or an ancestor's.
import {px} from '../paint.js'

export type Corner = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left'
export const cornerNames: readonly Corner[] = ['top-left', 'top-right', 'bottom-right', 'bottom-left']

/** An inset of a positioned box, or undefined when it is `auto`. */
const inset = (value: string) => (value === 'auto' ? undefined : px(value))

/**
 * The corners an element draws its edge over its contents at: those a pseudo-element covers, positioned on the
 * element's box (anchored to both sides, and to the corner's top or bottom), with a border at least `width` wide,
 * rounded at least as round, in a stacking context of the element's own. The kit's frame (`pk-frame`, a `Group`) covers
 * all four; a data table's frame its top and bottom separately.
 */
function overlaidCorners(element: Element, width: number): Set<Corner> {
  const style = getComputedStyle(element)
  const covered = new Set<Corner>()
  if (style.isolation !== 'isolate' && style.zIndex === 'auto') return covered
  for (const pseudo of ['::after', '::before']) {
    const overlay = getComputedStyle(element, pseudo)
    if (overlay.content === 'none' || overlay.content === 'normal' || overlay.position !== 'absolute') continue
    const [top, right, bottom, left] = ['top', 'right', 'bottom', 'left'].map(side => inset(overlay.getPropertyValue(side)))
    if (left === undefined || right === undefined || left > 0.01 || right > 0.01) continue
    for (const corner of cornerNames) {
      const vertical = corner.startsWith('top') ? top : bottom
      const side = corner.startsWith('top') ? 'top' : 'bottom'
      if (vertical === undefined || vertical > 0.01) continue
      if (
        overlay.getPropertyValue(`border-${side}-style`) === 'none' ||
        px(overlay.getPropertyValue(`border-${side}-width`)) < width - 0.01
      ) {
        continue
      }
      if (px(overlay.getPropertyValue(`border-${corner}-radius`)) < px(style.getPropertyValue(`border-${corner}-radius`)) - 0.01) continue
      covered.add(corner)
    }
  }
  return covered
}

/** A corner of a box, in the page. */
export const cornerPoint = (box: DOMRect, corner: Corner) => ({
  x: corner.endsWith('left') ? box.left : box.right,
  y: corner.startsWith('top') ? box.top : box.bottom,
})

/**
 * Whether an element's corner has its edge drawn over its contents: by the element itself, or by an ancestor whose
 * own corner is the same (a data table's frame, over its heading's and last row's corners).
 */
export function cornerOverlaid(element: Element, corner: Corner, width: number): boolean {
  const at = cornerPoint(element.getBoundingClientRect(), corner)
  for (let frame: Element | null = element; frame; frame = frame.parentElement) {
    const point = cornerPoint(frame.getBoundingClientRect(), corner)
    if (Math.abs(point.x - at.x) > width + 1 || Math.abs(point.y - at.y) > width + 1) break
    if (overlaidCorners(frame, width).has(corner)) return true
  }
  return false
}
