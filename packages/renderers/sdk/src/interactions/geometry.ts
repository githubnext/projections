// Where elements are visible: through their clipping ancestors, their scrolling ancestors and the viewport.
import type {AnchorRect} from '../protocol.js'

interface Edges {
  left: number
  top: number
  right: number
  bottom: number
}

/** Whether two anchors are the same to within half a pixel; absent ones are the same only as each other. */
export function sameRect(a: AnchorRect | null | undefined, b: AnchorRect | null): boolean {
  if (!a || !b) return a === b
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5
}

/** Whether an element clips its content (its overflow isn't visible both ways), from `clips` when it has the answer. */
function clips(view: Window, element: Element, cache?: Map<Element, boolean>): boolean {
  let clipping = cache?.get(element)
  if (clipping === undefined) {
    const style = view.getComputedStyle(element)
    clipping = !(style.overflowX === 'visible' && style.overflowY === 'visible')
    cache?.set(element, clipping)
  }
  return clipping
}

/** `edges` narrowed to every clipping ancestor of `element`, up to the document element. */
function clipToAncestors(view: Window, element: Element, edges: Edges, cache?: Map<Element, boolean>): Edges {
  let {left, top, right, bottom} = edges
  const root = element.ownerDocument.documentElement
  for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
    if (!clips(view, parent, cache)) continue
    const clip = parent.getBoundingClientRect()
    left = Math.max(left, clip.left)
    top = Math.max(top, clip.top)
    right = Math.min(right, clip.right)
    bottom = Math.min(bottom, clip.bottom)
  }
  return {left, top, right, bottom}
}

/** The part of an element's box that is visible through its scrolling ancestors and the viewport. */
export function visibleRect(view: Window, element: Element, cache?: Map<Element, boolean>): AnchorRect | null {
  const box = element.getBoundingClientRect()
  if (box.width <= 0 && box.height <= 0) return null
  if (box.right < 1 || box.bottom < 1 || box.left > view.innerWidth - 1 || box.top > view.innerHeight - 1) return null
  const clipped = clipToAncestors(view, element, box, cache)
  const left = Math.max(clipped.left, 0)
  const top = Math.max(clipped.top, 0)
  const right = Math.min(clipped.right, view.innerWidth)
  const bottom = Math.min(clipped.bottom, view.innerHeight)
  // A straight horizontal or vertical line has no width or height, but is still visible.
  if (right < left || bottom < top || (right - left < 1 && bottom - top < 1)) return null
  return {x: left, y: top, width: right - left, height: bottom - top}
}

/** The area an element can show through its clipping ancestors and the viewport. */
export function clipRect(view: Window, element: Element): AnchorRect | null {
  const viewport = {left: 0, top: 0, right: view.innerWidth, bottom: view.innerHeight}
  const {left, top, right, bottom} = clipToAncestors(view, element, viewport)
  return right - left < 1 || bottom - top < 1 ? null : {x: left, y: top, width: right - left, height: bottom - top}
}
