// The corners a box draws its edge over its contents at: an overlaid pseudo-element, its own or an ancestor's.
import {colorAlpha, px} from '../paint.js'
import {fittedRadii} from '../rings/edges.js'

export type Corner = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left'
export const cornerNames: readonly Corner[] = ['top-left', 'top-right', 'bottom-right', 'bottom-left']

/** Each corner's radius as an element draws it: the smaller of its two, fitted as CSS fits them. */
export function cornerRadii(element: Element): Map<Corner, number> {
  const box = element.getBoundingClientRect()
  const fitted = fittedRadii(getComputedStyle(element), box.width, box.height)
  return new Map(cornerNames.map((corner, index) => [corner, Math.min(...(fitted[index] ?? [0, 0]))]))
}

/** A box's z-index as a number: `auto` is 0. */
const zIndex = (style: CSSStyleDeclaration) => Number.parseInt(style.zIndex, 10) || 0

/**
 * Where a fill paints in a frame's stacking context: the z-index of its outermost positioned ancestor inside the frame
 * (its own included), or below every positioned box when none is positioned.
 */
function layerIn(frame: Element, fill: Element): number {
  let layer = Number.NEGATIVE_INFINITY
  for (let element: Element | null = fill; element && element !== frame; element = element.parentElement) {
    const style = getComputedStyle(element)
    if (style.position !== 'static') layer = zIndex(style)
  }
  return layer
}

/** An inset of a positioned box, or undefined when it is `auto`. */
const inset = (value: string) => (value === 'auto' ? undefined : px(value))

/**
 * The corners an element draws its edge over `fill` at: those a pseudo-element covers, positioned on the element's box
 * (anchored to both sides, and to the corner's top or bottom), with a visible border at least `width` wide, rounded at
 * least as round, in a stacking context of the element's own and painted after the fill (a higher z-index, or the same
 * as an `::after`, which follows the contents). The kit's frame (`pk-frame`, a `Group`) covers all four; a data table's
 * frame its top and bottom separately.
 */
function overlaidCorners(element: Element, width: number, fill: Element): Set<Corner> {
  const style = getComputedStyle(element)
  const covered = new Set<Corner>()
  if (style.isolation !== 'isolate' && style.zIndex === 'auto') return covered
  const fillLayer = layerIn(element, fill)
  const radii = cornerRadii(element)
  for (const pseudo of ['::after', '::before']) {
    const overlay = getComputedStyle(element, pseudo)
    if (overlay.content === 'none' || overlay.content === 'normal' || overlay.position !== 'absolute') continue
    if (Number(overlay.opacity) <= 0.01 || overlay.visibility === 'hidden') continue
    const layer = zIndex(overlay)
    if (pseudo === '::after' ? layer < fillLayer : layer <= fillLayer) continue
    const box = element.getBoundingClientRect()
    const drawn = fittedRadii(overlay, box.width + 2 * width, box.height + 2 * width)
    const [top, right, bottom, left] = ['top', 'right', 'bottom', 'left'].map(side => inset(overlay.getPropertyValue(side)))
    if (left === undefined || right === undefined || left > 0.01 || right > 0.01) continue
    for (const corner of cornerNames) {
      const vertical = corner.startsWith('top') ? top : bottom
      const side = corner.startsWith('top') ? 'top' : 'bottom'
      if (vertical === undefined || vertical > 0.01) continue
      if (
        overlay.getPropertyValue(`border-${side}-style`) === 'none' ||
        px(overlay.getPropertyValue(`border-${side}-width`)) < width - 0.01 ||
        colorAlpha(overlay.getPropertyValue(`border-${side}-color`)) <= 0.01
      ) {
        continue
      }
      if (Math.min(...(drawn[cornerNames.indexOf(corner)] ?? [0, 0])) < (radii.get(corner) ?? 0) - 0.01) continue
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
export function cornerOverlaid(element: Element, corner: Corner, width: number, fill: Element): boolean {
  const at = cornerPoint(element.getBoundingClientRect(), corner)
  for (let frame: Element | null = element; frame; frame = frame.parentElement) {
    const point = cornerPoint(frame.getBoundingClientRect(), corner)
    if (Math.abs(point.x - at.x) > width + 1 || Math.abs(point.y - at.y) > width + 1) break
    if (overlaidCorners(frame, width, fill).has(corner)) return true
  }
  return false
}
